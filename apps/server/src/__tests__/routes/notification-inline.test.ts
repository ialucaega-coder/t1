/**
 * Avisos de reservas y pedidos SIN Redis: la cola real corre inline (como antes
 * del cambio), la respuesta HTTP no espera el envío y un fallo del envío no la
 * rompe. Acá NO se mockea lib/queue ni services/notifications.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    booking: { update: vi.fn(), findFirst: vi.fn() },
    notification: { create: vi.fn(async (args) => ({ id: 'n1', ...args.data })) },
    user: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    business: { findUnique: vi.fn(async () => ({ whatsappNumber: null })) },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));
vi.mock('../../services/email', () => ({ sendGenericNotification: vi.fn(async () => true) }));
vi.mock('../../services/whatsapp/client', () => ({ isConfigured: vi.fn(() => false), sendMessage: vi.fn() }));
vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: 'user_1', businessId: 'biz_1', role: 'ADMIN' };
    next();
  },
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

import { prisma } from '../../lib/prisma';
import { bookingsRouter } from '../../routes/bookings';
import { errorHandler } from '../../middleware/errorHandler';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;
const flush = () => new Promise((r) => setTimeout(r, 30));

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/bookings', bookingsRouter);
  app.use(errorHandler);
  return app;
}

const confirmed = (id: string) => ({
  id, status: 'CONFIRMED', businessId: 'biz_1', clientId: 'c1', startTime: '15:00', date: new Date('2026-10-01T00:00:00Z'),
  client: { name: 'Ana' }, service: { name: 'Corte' },
});

describe('avisos por la cola sin Redis (inline)', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.QUEUES_DISABLED = 'true';
  });

  it('ejecuta el aviso inline (como hoy): relee la reserva por negocio y notifica al cliente', async () => {
    mock(prisma.booking.update).mockResolvedValue(confirmed('bk_inline_1'));
    mock(prisma.booking.findFirst).mockResolvedValue(confirmed('bk_inline_1'));
    mock(prisma.user.findFirst).mockResolvedValue({ email: 'ana@x.com', phone: null });

    const res = await request(app).patch('/api/bookings/bk_inline_1/status').send({ status: 'CONFIRMED' });
    await flush();

    expect(res.status).toBe(200);
    expect(mock(prisma.booking.findFirst).mock.calls[0][0].where).toEqual({ id: 'bk_inline_1', businessId: 'biz_1' });
    expect(mock(prisma.notification.create).mock.calls[0][0].data).toMatchObject({ type: 'BOOKING_CONFIRMED', userId: 'c1', channel: 'EMAIL' });
  });

  it('un fallo del envío no rompe la respuesta HTTP', async () => {
    mock(prisma.booking.update).mockResolvedValue(confirmed('bk_inline_2'));
    mock(prisma.booking.findFirst).mockRejectedValue(new Error('db caída'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app).patch('/api/bookings/bk_inline_2/status').send({ status: 'CONFIRMED' });
    await flush();

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CONFIRMED');
    err.mockRestore();
  });

  it('la respuesta no espera al aviso: responde aunque el aviso nunca termine', async () => {
    mock(prisma.booking.update).mockResolvedValue(confirmed('bk_inline_3'));
    mock(prisma.booking.findFirst).mockReturnValue(new Promise(() => {})); // el aviso queda colgado

    const res = await request(app).patch('/api/bookings/bk_inline_3/status').send({ status: 'CONFIRMED' });

    expect(res.status).toBe(200);
  });

  it('el mismo evento repetido (doble PATCH) avisa UNA sola vez (dedupe por jobId también inline)', async () => {
    mock(prisma.booking.update).mockResolvedValue(confirmed('bk_inline_4'));
    mock(prisma.booking.findFirst).mockResolvedValue(confirmed('bk_inline_4'));
    mock(prisma.user.findFirst).mockResolvedValue({ email: 'ana@x.com', phone: null });

    await request(app).patch('/api/bookings/bk_inline_4/status').send({ status: 'CONFIRMED' });
    await request(app).patch('/api/bookings/bk_inline_4/status').send({ status: 'CONFIRMED' });
    await flush();

    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
  });

  it('un fallo transitorio del aviso se reintenta inline y termina avisando', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mock(prisma.booking.update).mockResolvedValue(confirmed('bk_inline_5'));
    mock(prisma.booking.findFirst)
      .mockRejectedValueOnce(new Error('db caída un instante'))
      .mockResolvedValue(confirmed('bk_inline_5'));
    mock(prisma.user.findFirst).mockResolvedValue({ email: 'ana@x.com', phone: null });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    await request(app).patch('/api/bookings/bk_inline_5/status').send({ status: 'CONFIRMED' });
    await vi.advanceTimersByTimeAsync(6000); // backoff de 5 s
    await vi.advanceTimersByTimeAsync(100);

    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    err.mockRestore();
    vi.useRealTimers();
  });
});
