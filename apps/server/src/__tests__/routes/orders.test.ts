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
    product: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    user: { findFirst: vi.fn() },
    order: {
      create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(),
      updateMany: vi.fn(), findFirstOrThrow: vi.fn(),
    },
    transaction: { create: vi.fn(), findFirst: vi.fn() },
    connection: { findFirst: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));
vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    // El header x-test-role permite probar el rechazo de rol CLIENT.
    const role = (req.header('x-test-role') as 'ADMIN' | 'CLIENT' | undefined) ?? 'ADMIN';
    req.auth = { userId: 'user_1', businessId: 'biz_1', role };
    next();
  },
  requireStaff: (req: Request, res: Response, next: NextFunction) => {
    if (req.auth?.role === 'CLIENT') {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  },
}));
vi.mock('../../services/notifications', () => ({
  queueNotification: vi.fn(async () => 'queued'),
}));

import { prisma } from '../../lib/prisma';
import { queueNotification } from '../../services/notifications';
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

// Pedido previo equivalente a `payload` (mismos ítems y cliente por defecto = usuario autenticado).
const PRIOR_ORDER = { clientId: 'user_1', items: [{ productId: 'prod_1', quantity: 2 }] };

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
    // Guarda de stock: por defecto el descuento afecta 1 fila (hay stock).
    mock(prisma.product.updateMany).mockResolvedValue({ count: 1 });
  });

  it('crea un pedido normalmente sin Idempotency-Key', async () => {
    const res = await request(app).post('/api/orders').send(payload);

    expect(res.status).toBe(201);
    expect(prisma.order.create).toHaveBeenCalledTimes(1);
    expect(prisma.connection.create).not.toHaveBeenCalled(); // sin clave no registra idempotencia
    // El aviso va por la cola de avisos (con jobId idempotente en el servicio), con ids y negocio.
    expect(mock(queueNotification)).toHaveBeenCalledWith(expect.objectContaining({ event: 'order-created', businessId: 'biz_1' }));
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
        data: expect.objectContaining({ type: 'ORDER_IDEMPOTENCY', config: { key: 'abc-123', entityId: 'order_1' } }),
      })
    );
  });

  it('replay con la misma clave devuelve el pedido existente sin recrear (fast path)', async () => {
    // Ya existe una Connection para esa clave apuntando a order_1.
    mock(prisma.connection.findFirst).mockResolvedValue({ config: { key: 'abc-123', entityId: 'order_1' } });
    mock(prisma.order.findFirst).mockResolvedValue({ id: 'order_1', totalPrice: 2000, ...PRIOR_ORDER });

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
    expect(mock(queueNotification)).not.toHaveBeenCalled();
  });

  it('deduplica dentro de la transacción si la clave aparece tras el fast path (carrera)', async () => {
    // Fast path no encuentra nada (null), pero el chequeo DENTRO de la tx sí
    // (otra request concurrente la creó): se devuelve ese pedido, no se recrea.
    mock(prisma.connection.findFirst)
      .mockResolvedValueOnce(null) // fast path
      .mockResolvedValueOnce({ config: { key: 'race-1', entityId: 'order_existing' } }); // dentro de la tx
    mock(prisma.order.findFirst).mockResolvedValue({ id: 'order_existing', totalPrice: 2000, ...PRIOR_ORDER });

    const res = await request(app)
      .post('/api/orders')
      .set('Idempotency-Key', 'race-1')
      .send(payload);

    expect(res.status).toBe(200);
    expect(prisma.$executeRaw).toHaveBeenCalled(); // tomó el advisory lock
    expect(prisma.order.create).not.toHaveBeenCalled();
  });
});

describe('routes/orders — POST / (alta manual: precios y productos del servidor)', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    mock(prisma.order.create).mockResolvedValue({ id: 'order_1', totalPrice: 3000 });
    mock(prisma.transaction.create).mockResolvedValue({ id: 'tx_1' });
    mock(prisma.connection.findFirst).mockResolvedValue(null);
    mock(prisma.$executeRaw).mockResolvedValue(undefined);
    mock(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
    mock(prisma.product.updateMany).mockResolvedValue({ count: 1 });
    mock(prisma.user.findFirst).mockResolvedValue({ id: 'cli_1' });
  });

  it('ignora cualquier precio enviado por el front: usa el precio del producto en la base', async () => {
    mock(prisma.product.findMany).mockResolvedValue([{ id: 'prod_1', price: 1000, name: 'Corte', businessId: 'biz_1' }]);

    const res = await request(app)
      .post('/api/orders')
      .send({ items: [{ productId: 'prod_1', quantity: 3, price: 1 }], paymentMethod: 'CASH', totalPrice: 1 });

    expect(res.status).toBe(201);
    const data = mock(prisma.order.create).mock.calls[0][0].data;
    expect(data.totalPrice).toBe(3000);
    expect(data.items.create[0]).toMatchObject({ productId: 'prod_1', quantity: 3, price: 1000 });
  });

  it('solo busca productos activos, no borrados y del negocio', async () => {
    mock(prisma.product.findMany).mockResolvedValue([{ id: 'prod_1', price: 1000, businessId: 'biz_1' }]);
    await request(app).post('/api/orders').send({ items: [{ productId: 'prod_1', quantity: 1 }], paymentMethod: 'CASH' });
    expect(mock(prisma.product.findMany).mock.calls[0][0].where).toMatchObject({
      businessId: 'biz_1', isActive: true, deletedAt: null,
    });
  });

  it('un producto inactivo/ajeno (no encontrado) devuelve 400 y no crea nada', async () => {
    mock(prisma.product.findMany).mockResolvedValue([]);
    const res = await request(app).post('/api/orders').send({ items: [{ productId: 'prod_x', quantity: 1 }], paymentMethod: 'CASH' });
    expect(res.status).toBe(400);
    expect(prisma.order.create).not.toHaveBeenCalled();
    expect(prisma.transaction.create).not.toHaveBeenCalled();
  });

  it('une líneas repetidas del mismo producto en vez de fallar', async () => {
    mock(prisma.product.findMany).mockResolvedValue([{ id: 'prod_1', price: 1000, businessId: 'biz_1' }]);
    const res = await request(app).post('/api/orders').send({
      items: [{ productId: 'prod_1', quantity: 1 }, { productId: 'prod_1', quantity: 2 }],
      paymentMethod: 'CASH',
    });
    expect(res.status).toBe(201);
    const data = mock(prisma.order.create).mock.calls[0][0].data;
    expect(data.items.create).toHaveLength(1);
    expect(data.items.create[0].quantity).toBe(3);
    expect(data.totalPrice).toBe(3000);
  });

  it('rechaza con 404 un clientId de otro negocio', async () => {
    mock(prisma.product.findMany).mockResolvedValue([{ id: 'prod_1', price: 1000, businessId: 'biz_1' }]);
    mock(prisma.user.findFirst).mockResolvedValue(null);
    const res = await request(app).post('/api/orders').send({
      items: [{ productId: 'prod_1', quantity: 1 }], paymentMethod: 'CASH', clientId: 'cli_otro_negocio',
    });
    expect(res.status).toBe(404);
    expect(mock(prisma.user.findFirst).mock.calls[0][0].where).toMatchObject({ id: 'cli_otro_negocio', businessId: 'biz_1' });
    expect(prisma.order.create).not.toHaveBeenCalled();
  });
});

describe('routes/orders — POST / (orden de locks, tope de total, clave con otro contenido)', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    mock(prisma.order.create).mockResolvedValue({ id: 'order_1', totalPrice: 3000 });
    mock(prisma.transaction.create).mockResolvedValue({ id: 'tx_1' });
    mock(prisma.transaction.findFirst).mockResolvedValue({ paymentMethod: 'CASH' });
    mock(prisma.connection.findFirst).mockResolvedValue(null);
    mock(prisma.connection.create).mockResolvedValue({ id: 'conn_1' });
    mock(prisma.$executeRaw).mockResolvedValue(undefined);
    mock(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
    mock(prisma.product.updateMany).mockResolvedValue({ count: 1 });
    mock(prisma.product.findMany).mockResolvedValue([
      { id: 'prod_a', price: 100, name: 'A', businessId: 'biz_1' },
      { id: 'prod_b', price: 200, name: 'B', businessId: 'biz_1' },
    ]);
  });

  const stockOrder = () => mock(prisma.product.updateMany).mock.calls.map((c) => c[0].where.id);

  it('descuenta stock en orden estable por productId: (A,B) y (B,A) toman los locks igual', async () => {
    await request(app).post('/api/orders').send({
      items: [{ productId: 'prod_b', quantity: 1 }, { productId: 'prod_a', quantity: 1 }], paymentMethod: 'CASH',
    });
    expect(stockOrder()).toEqual(['prod_a', 'prod_b']);

    vi.clearAllMocks();
    mock(prisma.order.create).mockResolvedValue({ id: 'order_2', totalPrice: 300 });
    mock(prisma.product.updateMany).mockResolvedValue({ count: 1 });
    mock(prisma.product.findMany).mockResolvedValue([
      { id: 'prod_a', price: 100, name: 'A', businessId: 'biz_1' },
      { id: 'prod_b', price: 200, name: 'B', businessId: 'biz_1' },
    ]);
    mock(prisma.connection.findFirst).mockResolvedValue(null);
    mock(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
    await request(app).post('/api/orders').send({
      items: [{ productId: 'prod_a', quantity: 1 }, { productId: 'prod_b', quantity: 1 }], paymentMethod: 'CASH',
    });
    expect(stockOrder()).toEqual(['prod_a', 'prod_b']);
  });

  it('un total que no entra en Decimal(10,2) da 400 claro y no crea nada', async () => {
    mock(prisma.product.findMany).mockResolvedValue([{ id: 'prod_a', price: 99_999_999, name: 'A', businessId: 'biz_1' }]);
    const res = await request(app).post('/api/orders').send({ items: [{ productId: 'prod_a', quantity: 2 }], paymentMethod: 'CASH' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/máximo permitido/);
    expect(prisma.order.create).not.toHaveBeenCalled();
    expect(prisma.transaction.create).not.toHaveBeenCalled();
  });

  it('rechaza notas de más de 2000 caracteres al crear', async () => {
    const res = await request(app).post('/api/orders').send({
      items: [{ productId: 'prod_a', quantity: 1 }], paymentMethod: 'CASH', notes: 'a'.repeat(2001),
    });
    expect(res.status).toBe(400);
  });

  describe('misma Idempotency-Key con otro contenido', () => {
    const replay = (body: object) => {
      mock(prisma.connection.findFirst).mockResolvedValue({ config: { key: 'k1', entityId: 'order_1' } });
      mock(prisma.order.findFirst).mockResolvedValue({
        id: 'order_1', totalPrice: 300, clientId: 'user_1', items: [{ productId: 'prod_a', quantity: 1 }, { productId: 'prod_b', quantity: 1 }],
      });
      return request(app).post('/api/orders').set('Idempotency-Key', 'k1').send(body);
    };
    const same = { items: [{ productId: 'prod_b', quantity: 1 }, { productId: 'prod_a', quantity: 1 }], paymentMethod: 'CASH' };

    it('mismo contenido (aunque en otro orden de líneas) es un replay 200', async () => {
      const res = await replay(same);
      expect(res.status).toBe(200);
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it('otras cantidades devuelven 409 y no crean nada', async () => {
      const res = await replay({ ...same, items: [{ productId: 'prod_a', quantity: 5 }, { productId: 'prod_b', quantity: 1 }] });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/Idempotency-Key/);
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it('otros productos devuelven 409', async () => {
      const res = await replay({ ...same, items: [{ productId: 'prod_z', quantity: 1 }] });
      expect(res.status).toBe(409);
    });

    it('otro método de pago devuelve 409', async () => {
      const res = await replay({ ...same, paymentMethod: 'CARD' });
      expect(res.status).toBe(409);
    });
  });
});

describe('routes/orders — GET / (búsqueda y filtro por estado)', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    mock(prisma.order.findMany).mockResolvedValue([]);
    mock(prisma.order.count).mockResolvedValue(0);
  });

  const whereOf = () => mock(prisma.order.findMany).mock.calls[0][0].where;

  it('filtra por estado, siempre acotado al negocio, y conserva la paginación', async () => {
    const res = await request(app).get('/api/orders?status=PENDING&page=2&pageSize=10');
    expect(res.status).toBe(200);
    expect(whereOf()).toEqual({ businessId: 'biz_1', status: 'PENDING' });
    expect(mock(prisma.order.findMany).mock.calls[0][0]).toMatchObject({ skip: 10, take: 10 });
    expect(res.body).toMatchObject({ page: 2, pageSize: 10, total: 0 });
  });

  it('estado inválido devuelve 400', async () => {
    const res = await request(app).get('/api/orders?status=NOPE');
    expect(res.status).toBe(400);
    expect(prisma.order.findMany).not.toHaveBeenCalled();
  });

  it('busca por nombre/email/teléfono del cliente', async () => {
    await request(app).get('/api/orders?search=Ana');
    const where = whereOf();
    expect(where.businessId).toBe('biz_1');
    expect(where.OR).toEqual(expect.arrayContaining([
      { client: { name: { contains: 'Ana', mode: 'insensitive' } } },
      { client: { email: { contains: 'Ana', mode: 'insensitive' } } },
      { client: { phone: { contains: 'Ana' } } },
    ]));
  });

  it('busca por código de orden ORD-XXXXXXXX (id termina en el sufijo, en minúscula)', async () => {
    await request(app).get('/api/orders?search=ORD-ABCD1234');
    expect(whereOf().OR).toEqual(expect.arrayContaining([{ id: { endsWith: 'abcd1234' } }]));
  });

  it('combina estado + búsqueda y funciona con la paginación limit/offset', async () => {
    await request(app).get('/api/orders?status=READY&search=Ana&limit=5&offset=5');
    expect(whereOf()).toMatchObject({ businessId: 'biz_1', status: 'READY' });
    expect(whereOf().OR).toBeDefined();
    expect(mock(prisma.order.findMany).mock.calls[0][0]).toMatchObject({ skip: 5, take: 5 });
  });

  it('un CLIENT no puede listar los pedidos del negocio (403)', async () => {
    const res = await request(app).get('/api/orders').set('x-test-role', 'CLIENT');
    expect(res.status).toBe(403);
    expect(prisma.order.findMany).not.toHaveBeenCalled();
  });
});

describe('routes/orders — PATCH /:id/status (transiciones)', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    mock(prisma.order.updateMany).mockResolvedValue({ count: 1 });
    mock(prisma.order.findFirstOrThrow).mockResolvedValue({ id: 'order_1', status: 'X', totalPrice: 1, clientId: 'c' });
  });

  const setCurrent = (status: string | null) =>
    mock(prisma.order.findFirst).mockResolvedValue(status ? { status, id: 'order_1' } : null);
  const patch = (status: string) => request(app).patch('/api/orders/order_1/status').send({ status });

  it.each([
    ['PENDING', 'CONFIRMED'],
    ['CONFIRMED', 'PREPARING'],
    ['READY', 'DELIVERED'],
    ['PENDING', 'DELIVERED'], // salto hacia adelante (venta de mostrador)
    ['PENDING', 'CANCELLED'],
    ['READY', 'CANCELLED'],
  ])('permite %s -> %s', async (from, to) => {
    setCurrent(from);
    const res = await patch(to);
    expect(res.status).toBe(200);
    expect(mock(prisma.order.updateMany).mock.calls[0][0]).toEqual({
      where: { id: 'order_1', businessId: 'biz_1', status: from },
      data: { status: to },
    });
  });

  it.each([
    ['READY', 'PREPARING'], // hacia atrás
    ['CONFIRMED', 'PENDING'],
    ['DELIVERED', 'CANCELLED'], // un entregado no se cancela
    ['DELIVERED', 'READY'],
    ['CANCELLED', 'PENDING'], // un cancelado no se reabre
    ['CANCELLED', 'CONFIRMED'],
  ])('rechaza %s -> %s con 409 y no modifica nada', async (from, to) => {
    setCurrent(from);
    const res = await patch(to);
    expect(res.status).toBe(409);
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('repetir el estado actual no cambia nada ni vuelve a notificar', async () => {
    setCurrent('CANCELLED');
    const res = await patch('CANCELLED');
    expect(res.status).toBe(200);
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
    expect(mock(queueNotification)).not.toHaveBeenCalled();
  });

  it('busca el pedido por negocio: uno de otro negocio da 404', async () => {
    setCurrent(null);
    const res = await patch('CONFIRMED');
    expect(res.status).toBe(404);
    expect(mock(prisma.order.findFirst).mock.calls[0][0].where).toEqual({ id: 'order_1', businessId: 'biz_1' });
  });

  it('si el estado cambió en el medio (carrera) responde 409', async () => {
    setCurrent('PENDING');
    mock(prisma.order.updateMany).mockResolvedValue({ count: 0 });
    const res = await patch('CONFIRMED');
    expect(res.status).toBe(409);
    expect(mock(queueNotification)).not.toHaveBeenCalled();
  });

  it('notifica al cliente cuando la transición es válida', async () => {
    setCurrent('PENDING');
    await patch('CANCELLED');
    expect(mock(queueNotification)).toHaveBeenCalledTimes(1);
    expect(mock(queueNotification)).toHaveBeenCalledWith(expect.objectContaining({ event: 'order-status', id: 'order_1', businessId: 'biz_1' }));
  });

  it('un CLIENT no puede cambiar estados (403)', async () => {
    const res = await request(app).patch('/api/orders/order_1/status').set('x-test-role', 'CLIENT').send({ status: 'CANCELLED' });
    expect(res.status).toBe(403);
  });
});

describe('routes/orders — PATCH /:id/notes (nota interna)', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    mock(prisma.order.updateMany).mockResolvedValue({ count: 1 });
    mock(prisma.order.findFirstOrThrow).mockResolvedValue({ id: 'order_1', notes: 'x' });
  });

  it('guarda la nota en Order.notes acotada al negocio', async () => {
    const res = await request(app).patch('/api/orders/order_1/notes').send({ notes: '  Entregar por la tarde  ' });
    expect(res.status).toBe(200);
    expect(mock(prisma.order.updateMany).mock.calls[0][0]).toEqual({
      where: { id: 'order_1', businessId: 'biz_1' },
      data: { notes: 'Entregar por la tarde' },
    });
  });

  it('una nota vacía borra la nota (null)', async () => {
    await request(app).patch('/api/orders/order_1/notes').send({ notes: '   ' });
    expect(mock(prisma.order.updateMany).mock.calls[0][0].data).toEqual({ notes: null });
  });

  it('pedido de otro negocio o inexistente da 404', async () => {
    mock(prisma.order.updateMany).mockResolvedValue({ count: 0 });
    const res = await request(app).patch('/api/orders/order_ajeno/notes').send({ notes: 'hola' });
    expect(res.status).toBe(404);
  });

  it('rechaza notas de más de 2000 caracteres (400)', async () => {
    const res = await request(app).patch('/api/orders/order_1/notes').send({ notes: 'a'.repeat(2001) });
    expect(res.status).toBe(400);
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('un CLIENT no puede editar notas (403)', async () => {
    const res = await request(app).patch('/api/orders/order_1/notes').set('x-test-role', 'CLIENT').send({ notes: 'x' });
    expect(res.status).toBe(403);
  });
});
