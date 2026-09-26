/**
 * Pruebas de la reserva pública (routes/publicChat.ts → POST /book/:slug):
 * validación server-side del turno (dentro de horario + sin solape) para evitar
 * doble-reserva y horarios fuera de agenda enviados directo a la API.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    business: { findUnique: vi.fn() },
    service: { findFirst: vi.fn() },
    user: { findFirst: vi.fn(), create: vi.fn() },
    professional: { findFirst: vi.fn() },
    schedule: { findMany: vi.fn() },
    booking: { findMany: vi.fn(), create: vi.fn() },
    notification: { create: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));
vi.mock('../../services/chatbot', () => ({ processMessage: vi.fn() }));
vi.mock('../../lib/socket', () => ({ getIO: vi.fn(() => null) }));
vi.mock('../../services/whatsapp/client', () => ({
  isConfigured: vi.fn(() => true),
  sendMessage: vi.fn(async () => 'SID'),
}));
vi.mock('../../lib/otp', () => ({
  issueOtp: vi.fn(async () => '123456'),
  verifyOtp: vi.fn(async () => 'ok'),
  publicBookingRequiresOtp: vi.fn(() => false), // opt-in off por defecto
}));

import { prisma } from '../../lib/prisma';
import * as whatsapp from '../../services/whatsapp/client';
import { verifyOtp, publicBookingRequiresOtp } from '../../lib/otp';
import { publicChatRouter } from '../../routes/publicChat';
import { errorHandler } from '../../middleware/errorHandler';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/public', publicChatRouter);
  app.use(errorHandler);
  return app;
}

const payload = {
  serviceId: 'svc_1',
  professionalId: 'prof_1',
  date: '2026-10-05',
  time: '10:00',
  name: 'Ana',
  phone: '+5491100000000',
};

describe('routes/publicChat — POST /book/:slug', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    mock(prisma.business.findUnique).mockResolvedValue({ id: 'biz_1' });
    mock(prisma.service.findFirst).mockResolvedValue({ id: 'svc_1', duration: 30, price: 1000 });
    mock(prisma.user.findFirst).mockResolvedValue({ id: 'client_1' });
    mock(prisma.professional.findFirst).mockResolvedValue({ id: 'prof_1' });
    mock(prisma.notification.create).mockResolvedValue({ id: 'n1' });
    // Horario activo 09:00–18:00 ese día.
    mock(prisma.schedule.findMany).mockResolvedValue([{ startTime: '09:00', endTime: '18:00' }]);
    // $transaction ejecuta el callback con el propio mock como `tx`; el advisory
    // lock es un no-op en tests.
    mock(prisma.$executeRaw).mockResolvedValue(undefined);
    mock(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
  });

  it('crea la reserva cuando el turno está dentro de horario y libre', async () => {
    mock(prisma.booking.findMany).mockResolvedValue([]); // sin reservas ese día
    mock(prisma.booking.create).mockResolvedValue({ id: 'booking_1', startTime: '10:00', endTime: '10:30' });

    const res = await request(app).post('/api/public/book/mi-negocio').send(payload);

    expect(res.status).toBe(201);
    expect(prisma.booking.create).toHaveBeenCalled();
    // La creación pasa por la transacción con advisory lock (anti-race).
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it('rechaza (409) si el turno se solapa con una reserva existente', async () => {
    // Ya hay una reserva 10:00–10:30; el nuevo turno 10:00 se solapa.
    mock(prisma.booking.findMany).mockResolvedValue([{ startTime: '10:00', endTime: '10:30' }]);

    const res = await request(app).post('/api/public/book/mi-negocio').send(payload);

    expect(res.status).toBe(409);
    expect(prisma.booking.create).not.toHaveBeenCalled();
  });

  it('rechaza (409) si el turno cae fuera del horario activo', async () => {
    mock(prisma.schedule.findMany).mockResolvedValue([{ startTime: '09:00', endTime: '09:30' }]);
    mock(prisma.booking.findMany).mockResolvedValue([]);

    const res = await request(app).post('/api/public/book/mi-negocio').send({ ...payload, time: '17:00' });

    expect(res.status).toBe(409);
    expect(prisma.booking.create).not.toHaveBeenCalled();
  });

  it('no se solapa con un turno contiguo (10:30 tras 10:00–10:30)', async () => {
    mock(prisma.booking.findMany).mockResolvedValue([{ startTime: '10:00', endTime: '10:30' }]);
    mock(prisma.booking.create).mockResolvedValue({ id: 'booking_2', startTime: '10:30', endTime: '11:00' });

    const res = await request(app).post('/api/public/book/mi-negocio').send({ ...payload, time: '10:30' });

    expect(res.status).toBe(201);
  });

  it('devuelve 400 si faltan campos obligatorios', async () => {
    const res = await request(app).post('/api/public/book/mi-negocio').send({ name: 'Ana' });
    expect(res.status).toBe(400);
  });
});

describe('routes/publicChat — verificación de teléfono (OTP)', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    mock(whatsapp.isConfigured).mockReturnValue(true);
    mock(prisma.business.findUnique).mockResolvedValue({ id: 'biz_1', whatsappNumber: '+549351' });
    mock(prisma.service.findFirst).mockResolvedValue({ id: 'svc_1', duration: 30, price: 1000 });
    mock(prisma.schedule.findMany).mockResolvedValue([{ startTime: '09:00', endTime: '18:00' }]);
    mock(prisma.booking.findMany).mockResolvedValue([]);
    mock(prisma.user.findFirst).mockResolvedValue({ id: 'client_1' });
    mock(prisma.booking.create).mockResolvedValue({ id: 'booking_1' });
    mock(prisma.notification.create).mockResolvedValue({ id: 'n1' });
    mock(prisma.$executeRaw).mockResolvedValue(undefined);
    mock(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
  });

  it('request-otp envía el código por WhatsApp y responde sent:true', async () => {
    const res = await request(app).post('/api/public/book/mi-negocio/request-otp').send({ phone: '+549111' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: true });
    expect(mock(whatsapp.sendMessage)).toHaveBeenCalledWith('+549111', expect.stringContaining('123456'), '+549351');
  });

  it('request-otp responde 400 si WhatsApp no está configurado', async () => {
    mock(whatsapp.isConfigured).mockReturnValue(false);
    const res = await request(app).post('/api/public/book/mi-negocio/request-otp').send({ phone: '+549111' });
    expect(res.status).toBe(400);
  });

  it('con verificación activa, rechaza (401) la reserva sin OTP válido', async () => {
    mock(publicBookingRequiresOtp).mockReturnValue(true);
    mock(verifyOtp).mockResolvedValue('invalid');

    const res = await request(app).post('/api/public/book/mi-negocio').send(payload);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('PHONE_VERIFICATION_REQUIRED');
    expect(prisma.booking.create).not.toHaveBeenCalled();
  });

  it('con verificación activa y OTP válido, crea la reserva', async () => {
    mock(publicBookingRequiresOtp).mockReturnValue(true);
    mock(verifyOtp).mockResolvedValue('ok');

    const res = await request(app).post('/api/public/book/mi-negocio').send({ ...payload, otp: '123456' });

    expect(res.status).toBe(201);
    expect(mock(verifyOtp)).toHaveBeenCalledWith('biz_1', '+5491100000000', '123456');
    expect(prisma.booking.create).toHaveBeenCalled();
  });
});
