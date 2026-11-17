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
    mock(prisma.transaction.findFirst).mockResolvedValue({ id: 'tx_1', amount: 1500, type: 'SALE', paymentMethod: 'CASH', reference: null, notes: null });

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
    // Día calendario argentino: 00:00 AR = 03:00 UTC (no 00:00 UTC).
    expect(args.where.createdAt.gte).toEqual(new Date('2026-01-01T03:00:00.000Z'));
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

describe('routes/transactions — filtro de fechas (día calendario argentino)', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    mock(prisma.transaction.findMany).mockResolvedValue([]);
    mock(prisma.transaction.count).mockResolvedValue(0);
    mock(prisma.transaction.groupBy).mockResolvedValue([]);
  });

  const createdAtOf = () => mock(prisma.transaction.findMany).mock.calls[0][0].where.createdAt;

  it('`to` YYYY-MM-DD incluye el último día completo: límite exclusivo = 00:00 AR del día siguiente', async () => {
    await request(app).get('/api/transactions?from=2026-11-10&to=2026-11-16');
    const createdAt = createdAtOf();
    expect(createdAt.gte).toEqual(new Date('2026-11-10T00:00:00-03:00'));
    expect(createdAt.lt).toEqual(new Date('2026-11-17T00:00:00-03:00'));
    expect(createdAt.lte).toBeUndefined();
    // Una venta del 16/11 a las 23:30 AR (02:30 UTC del 17) queda adentro.
    const sale = new Date('2026-11-16T23:30:00-03:00').getTime();
    expect(sale).toBeLessThan(createdAt.lt.getTime());
    expect(sale).toBeGreaterThanOrEqual(createdAt.gte.getTime());
  });

  it('`from` arranca a las 00:00 de Argentina, no a las 21:00 del día anterior', async () => {
    await request(app).get('/api/transactions?from=2026-11-10');
    const gte = createdAtOf().gte as Date;
    expect(gte.toISOString()).toBe('2026-11-10T03:00:00.000Z');
    // Una venta de las 22:00 AR del 9/11 queda afuera.
    expect(new Date('2026-11-09T22:00:00-03:00').getTime()).toBeLessThan(gte.getTime());
  });

  it('el resumen usa el mismo rango que el listado', async () => {
    await request(app).get('/api/transactions/summary?to=2026-11-16');
    const where = mock(prisma.transaction.groupBy).mock.calls[0][0].where;
    expect(where.createdAt.lt).toEqual(new Date('2026-11-17T03:00:00.000Z'));
  });

  it('un instante ISO completo se respeta tal cual (lte)', async () => {
    await request(app).get('/api/transactions?to=2026-11-16T12:00:00Z');
    expect(createdAtOf().lte).toEqual(new Date('2026-11-16T12:00:00Z'));
  });

  it.each(['no-es-fecha', '2026-02-31', '2026-13-01'])('fecha inválida (%s) da 400 limpio', async (bad) => {
    const res = await request(app).get(`/api/transactions?to=${bad}`);
    expect(res.status).toBe(400);
    expect(res.body.details[0].message).toMatch(/Fecha inválida/);
    expect(prisma.transaction.findMany).not.toHaveBeenCalled();
  });
});

describe('routes/transactions — POST / (topes de columna)', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    mock(prisma.transaction.create).mockResolvedValue({ id: 'tx_1', amount: 1, type: 'SALE', paymentMethod: 'CASH', orderId: null });
    mock(prisma.connection.findFirst).mockResolvedValue(null);
    mock(prisma.$executeRaw).mockResolvedValue(undefined);
    mock(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
  });

  it('acepta el máximo exacto de Decimal(10,2)', async () => {
    const res = await request(app).post('/api/transactions').send({ ...payload, amount: 99_999_999.99 });
    expect(res.status).toBe(201);
  });

  it('rechaza con 400 y mensaje claro un monto mayor al máximo de la columna', async () => {
    const res = await request(app).post('/api/transactions').send({ ...payload, amount: 100_000_000 });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.details)).toContain('99.999.999,99');
    expect(prisma.transaction.create).not.toHaveBeenCalled();
  });

  it('rechaza reference > 500 y notes > 2000 caracteres', async () => {
    const r1 = await request(app).post('/api/transactions').send({ ...payload, reference: 'a'.repeat(501) });
    const r2 = await request(app).post('/api/transactions').send({ ...payload, notes: 'a'.repeat(2001) });
    expect(r1.status).toBe(400);
    expect(r2.status).toBe(400);
    expect(prisma.transaction.create).not.toHaveBeenCalled();
  });
});

describe('routes/transactions — POST / (misma Idempotency-Key, otro contenido)', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    mock(prisma.connection.findFirst).mockResolvedValue({ config: { key: 'pay-1', entityId: 'tx_1' } });
    mock(prisma.transaction.findFirst).mockResolvedValue({
      id: 'tx_1', amount: 1500, type: 'SALE', paymentMethod: 'CASH', reference: null, notes: null,
    });
    mock(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
    mock(prisma.$executeRaw).mockResolvedValue(undefined);
  });

  it('con otro monto devuelve 409 y no crea nada', async () => {
    const res = await request(app).post('/api/transactions').set('Idempotency-Key', 'pay-1').send({ ...payload, amount: 9999 });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Idempotency-Key/);
    expect(prisma.transaction.create).not.toHaveBeenCalled();
  });

  it('con otro método de pago devuelve 409', async () => {
    const res = await request(app).post('/api/transactions').set('Idempotency-Key', 'pay-1').send({ ...payload, paymentMethod: 'CARD' });
    expect(res.status).toBe(409);
  });

  it('con el mismo contenido sigue siendo un replay 200', async () => {
    const res = await request(app).post('/api/transactions').set('Idempotency-Key', 'pay-1').send(payload);
    expect(res.status).toBe(200);
  });

  it('un monto con más de 2 decimales (10.005, guardado como 10.01) es un replay legítimo, no 409', async () => {
    mock(prisma.transaction.findFirst).mockResolvedValue({
      id: 'tx_1', amount: '10.01', type: 'SALE', paymentMethod: 'CASH', reference: null, notes: null,
    });
    const res = await request(app).post('/api/transactions').set('Idempotency-Key', 'pay-1').send({ ...payload, amount: 10.005 });
    expect(res.status).toBe(200);
  });

  it('otro monto sigue dando 409 aunque difiera en centavos (10.02 vs 10.01)', async () => {
    mock(prisma.transaction.findFirst).mockResolvedValue({
      id: 'tx_1', amount: '10.01', type: 'SALE', paymentMethod: 'CASH', reference: null, notes: null,
    });
    const res = await request(app).post('/api/transactions').set('Idempotency-Key', 'pay-1').send({ ...payload, amount: 10.02 });
    expect(res.status).toBe(409);
  });
});

describe('routes/transactions — GET /export/csv (inyección de fórmulas)', () => {
  const app = buildApp();
  const row = (reference: string | null, notes: string | null) => ({
    createdAt: new Date('2026-11-16T12:00:00Z'), type: 'SALE', amount: 100, paymentMethod: 'CASH',
    reference, notes, order: null,
  });

  it('neutraliza celdas que empiezan con = + - @ tab o CR en referencia y notas', async () => {
    mock(prisma.transaction.findMany).mockResolvedValue([
      row('=HYPERLINK("http://x","clic")', '+cmd|calc'),
      row('-2+3', '@SUM(A1)'),
      row('\tcelda', '\rcelda'),
      row('Factura 123', null),
    ]);

    const res = await request(app).get('/api/transactions/export/csv');
    const csv = res.text;
    expect(csv).toContain(`"'=HYPERLINK(""http://x"",""clic"")"`);
    expect(csv).toContain(`"'+cmd|calc"`);
    expect(csv).toContain(`"'-2+3"`);
    expect(csv).toContain(`"'@SUM(A1)"`);
    expect(csv).toContain("\"'\tcelda\"");
    expect(csv).toContain("\"'\rcelda\"");
    // Un texto normal no se toca.
    expect(csv).toContain('"Factura 123"');
    expect(csv).not.toMatch(/,"[=+@-]/);
  });
});
