/**
 * Pruebas de idempotencia en el registro de cobros (routes/transactions.ts →
 * POST /). Es el path real del POS (PaymentModal): un doble-submit no debe
 * duplicar el movimiento contable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    transaction: { create: vi.fn(), findFirst: vi.fn() },
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
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
// Stub del disparo de automatizaciones (lo probamos aparte): evita la cadena real.
vi.mock('../../services/workflows', () => ({ dispatchEvent: vi.fn() }));

import { prisma } from '../../lib/prisma';
import { dispatchEvent } from '../../services/workflows';
import { transactionsRouter } from '../../routes/transactions';
import { errorHandler } from '../../middleware/errorHandler';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/transactions', transactionsRouter);
  app.use(errorHandler);
  return app;
}

const payload = { amount: 1500, type: 'SALE', paymentMethod: 'CASH' };

describe('routes/transactions — POST / (idempotencia)', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    mock(prisma.transaction.create).mockResolvedValue({ id: 'tx_1', amount: 1500, type: 'SALE', paymentMethod: 'CASH', orderId: null });
    mock(prisma.connection.create).mockResolvedValue({ id: 'conn_1' });
    mock(prisma.connection.findFirst).mockResolvedValue(null);
    mock(prisma.$executeRaw).mockResolvedValue(undefined);
    mock(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
  });

  it('crea el movimiento sin Idempotency-Key (201)', async () => {
    const res = await request(app).post('/api/transactions').send(payload);
    expect(res.status).toBe(201);
    expect(prisma.transaction.create).toHaveBeenCalledTimes(1);
    expect(prisma.connection.create).not.toHaveBeenCalled();
  });

  it('con Idempotency-Key crea y registra la clave', async () => {
    const res = await request(app).post('/api/transactions').set('Idempotency-Key', 'pay-1').send(payload);
    expect(res.status).toBe(201);
    expect(prisma.connection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'TRANSACTION_IDEMPOTENCY', config: { key: 'pay-1', entityId: 'tx_1' } }),
      })
    );
  });

  it('replay con la misma clave devuelve el movimiento existente sin recrear', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue({ config: { key: 'pay-1', entityId: 'tx_1' } });
    mock(prisma.transaction.findFirst).mockResolvedValue({ id: 'tx_1', amount: 1500 });

    const res = await request(app).post('/api/transactions').set('Idempotency-Key', 'pay-1').send(payload);

    expect(res.status).toBe(200);
    expect(prisma.transaction.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('routes/transactions — disparo de "pago_recibido"', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    mock(prisma.connection.findFirst).mockResolvedValue(null);
    mock(prisma.$executeRaw).mockResolvedValue(undefined);
    mock(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
  });

  it('dispara el trigger en una venta (SALE)', async () => {
    mock(prisma.transaction.create).mockResolvedValue({ id: 'tx_1', amount: 1500, type: 'SALE', paymentMethod: 'CASH', orderId: null });

    const res = await request(app).post('/api/transactions').send({ amount: 1500, type: 'SALE', paymentMethod: 'CASH' });

    expect(res.status).toBe(201);
    expect(dispatchEvent).toHaveBeenCalledWith(
      'biz_1',
      expect.objectContaining({ trigger: 'pago_recibido', payload: expect.objectContaining({ transactionId: 'tx_1', amount: 1500 }) }),
    );
  });

  it('NO dispara el trigger en una devolución (REFUND)', async () => {
    mock(prisma.transaction.create).mockResolvedValue({ id: 'tx_2', amount: 500, type: 'REFUND', paymentMethod: 'CASH', orderId: null });

    const res = await request(app).post('/api/transactions').send({ amount: 500, type: 'REFUND', paymentMethod: 'CASH' });

    expect(res.status).toBe(201);
    expect(dispatchEvent).not.toHaveBeenCalled();
  });
});
