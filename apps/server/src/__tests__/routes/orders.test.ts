/**
 * Pruebas de la creación de pedidos (routes/orders.ts → POST /), con foco en la
 * idempotencia por header `Idempotency-Key` (evita que un doble-submit duplique
 * el pedido + la transacción + el descuento de stock).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    product: { findMany: vi.fn(), update: vi.fn() },
    user: { findFirst: vi.fn() },
    order: { create: vi.fn(), findFirst: vi.fn() },
    transaction: { create: vi.fn() },
    connection: { findFirst: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));
vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: 'user_1', businessId: 'biz_1', role: 'ADMIN' };
    next();
  },
}));
vi.mock('../../services/notifications', () => ({
  sendOrderCreated: vi.fn(async () => undefined),
  sendOrderStatusUpdate: vi.fn(async () => undefined),
}));

import { prisma } from '../../lib/prisma';
import { sendOrderCreated } from '../../services/notifications';
import { ordersRouter } from '../../routes/orders';
import { errorHandler } from '../../middleware/errorHandler';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/orders', ordersRouter);
  app.use(errorHandler);
  return app;
}

const payload = {
  items: [{ productId: 'prod_1', quantity: 2 }],
  paymentMethod: 'CASH',
};

describe('routes/orders — POST / (idempotencia)', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    mock(prisma.product.findMany).mockResolvedValue([{ id: 'prod_1', price: 1000, businessId: 'biz_1' }]);
    mock(prisma.order.create).mockResolvedValue({ id: 'order_1', totalPrice: 2000 });
    mock(prisma.transaction.create).mockResolvedValue({ id: 'tx_1' });
    mock(prisma.connection.create).mockResolvedValue({ id: 'conn_1' });
    mock(prisma.connection.findFirst).mockResolvedValue(null); // sin clave previa
    mock(prisma.$executeRaw).mockResolvedValue(undefined);
    mock(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
    mock(prisma.product.update).mockResolvedValue({});
  });

  it('crea un pedido normalmente sin Idempotency-Key', async () => {
    const res = await request(app).post('/api/orders').send(payload);

    expect(res.status).toBe(201);
    expect(prisma.order.create).toHaveBeenCalledTimes(1);
    expect(prisma.connection.create).not.toHaveBeenCalled(); // sin clave no registra idempotencia
    expect(mock(sendOrderCreated)).toHaveBeenCalled();
  });

  it('con Idempotency-Key crea el pedido y registra la clave', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Idempotency-Key', 'abc-123')
      .send(payload);

    expect(res.status).toBe(201);
    expect(prisma.order.create).toHaveBeenCalledTimes(1);
    expect(prisma.connection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'ORDER_IDEMPOTENCY', config: { key: 'abc-123', orderId: 'order_1' } }),
      })
    );
  });

  it('replay con la misma clave devuelve el pedido existente sin recrear (fast path)', async () => {
    // Ya existe una Connection para esa clave apuntando a order_1.
    mock(prisma.connection.findFirst).mockResolvedValue({ config: { key: 'abc-123', orderId: 'order_1' } });
    mock(prisma.order.findFirst).mockResolvedValue({ id: 'order_1', totalPrice: 2000 });

    const res = await request(app)
      .post('/api/orders')
      .set('Idempotency-Key', 'abc-123')
      .send(payload);

    expect(res.status).toBe(200);
    expect(prisma.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'order_1', businessId: 'biz_1' } })
    );
    // No se creó nada nuevo ni se notificó.
    expect(prisma.order.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mock(sendOrderCreated)).not.toHaveBeenCalled();
  });

  it('deduplica dentro de la transacción si la clave aparece tras el fast path (carrera)', async () => {
    // Fast path no encuentra nada (null), pero el chequeo DENTRO de la tx sí
    // (otra request concurrente la creó): se devuelve ese pedido, no se recrea.
    mock(prisma.connection.findFirst)
      .mockResolvedValueOnce(null) // fast path
      .mockResolvedValueOnce({ config: { key: 'race-1', orderId: 'order_existing' } }); // dentro de la tx
    mock(prisma.order.findFirst).mockResolvedValue({ id: 'order_existing', totalPrice: 2000 });

    const res = await request(app)
      .post('/api/orders')
      .set('Idempotency-Key', 'race-1')
      .send(payload);

    expect(res.status).toBe(200);
    expect(prisma.$executeRaw).toHaveBeenCalled(); // tomó el advisory lock
    expect(prisma.order.create).not.toHaveBeenCalled();
  });
});
