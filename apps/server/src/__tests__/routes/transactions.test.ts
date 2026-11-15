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
    transaction: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
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

describe('routes/transactions — GET / (filtro por método de pago)', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    mock(prisma.transaction.findMany).mockResolvedValue([]);
    mock(prisma.transaction.count).mockResolvedValue(0);
  });

  it('filtra por paymentMethod (no por type) y siempre acota por businessId', async () => {
    const res = await request(app).get('/api/transactions?paymentMethod=CARD');

    expect(res.status).toBe(200);
    const where = mock(prisma.transaction.findMany).mock.calls[0][0].where;
    expect(where).toEqual({ businessId: 'biz_1', paymentMethod: 'CARD' });
    expect(where.type).toBeUndefined();
  });

  it('type sigue filtrando por tipo de movimiento', async () => {
    await request(app).get('/api/transactions?type=REFUND&paymentMethod=CASH');
    const where = mock(prisma.transaction.findMany).mock.calls[0][0].where;
    expect(where).toEqual({ businessId: 'biz_1', type: 'REFUND', paymentMethod: 'CASH' });
  });

  it('rechaza con 400 un método de pago inválido (antes un método en `type` rompía el filtro)', async () => {
    const res = await request(app).get('/api/transactions?type=CASH');
    expect(res.status).toBe(400);
    const res2 = await request(app).get('/api/transactions?paymentMethod=BITCOIN');
    expect(res2.status).toBe(400);
    expect(prisma.transaction.findMany).not.toHaveBeenCalled();
  });
});

describe('routes/transactions — GET /summary (totales reales)', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    mock(prisma.transaction.groupBy).mockResolvedValue([
      { type: 'SALE', _sum: { amount: 10000 }, _count: { _all: 40 } },
      { type: 'PARTIAL', _sum: { amount: 500 }, _count: { _all: 2 } },
      { type: 'REFUND', _sum: { amount: 1500 }, _count: { _all: 3 } },
    ]);
  });

  it('agrega con groupBy filtrado por businessId y los mismos filtros de la lista', async () => {
    const res = await request(app).get('/api/transactions/summary?paymentMethod=CASH&from=2026-01-01');

    expect(res.status).toBe(200);
    const args = mock(prisma.transaction.groupBy).mock.calls[0][0];
    expect(args.by).toEqual(['type']);
    expect(args.where).toMatchObject({ businessId: 'biz_1', paymentMethod: 'CASH' });
    expect(args.where.createdAt.gte).toEqual(new Date('2026-01-01'));
    expect(res.body).toEqual({
      sales: 10000,
      partial: 500,
      refunds: 1500,
      net: 9000,
      count: 45,
      counts: { SALE: 40, PARTIAL: 2, REFUND: 3 },
    });
  });

  it('sin movimientos devuelve ceros', async () => {
    mock(prisma.transaction.groupBy).mockResolvedValue([]);
    const res = await request(app).get('/api/transactions/summary');
    expect(res.body).toMatchObject({ sales: 0, refunds: 0, net: 0, count: 0 });
  });

  it('rechaza filtros inválidos con 400', async () => {
    const res = await request(app).get('/api/transactions/summary?type=NOPE');
    expect(res.status).toBe(400);
  });
});
