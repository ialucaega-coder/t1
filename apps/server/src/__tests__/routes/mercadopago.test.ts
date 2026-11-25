/**
 * Pruebas de integración de las rutas de MercadoPago (`src/routes/mercadopago.ts`):
 * status, connect (valida token + rol ADMIN), disconnect y payment-link. El
 * servicio de config y el cliente se mockean; auth por JWT real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../../services/mercadopago/config', () => ({
  getMpStatus: vi.fn(),
  saveMpConfig: vi.fn(),
  disconnectMp: vi.fn(),
  loadMpConfig: vi.fn(),
}));
vi.mock('../../services/mercadopago/client', () => ({
  testAccessToken: vi.fn(),
  createPaymentPreference: vi.fn(),
}));

// Gating por capacidad (consulta el plan en la base): se reemplaza por un control manual.
const gate = vi.hoisted(() => ({ denied: new Set<string>() }));
vi.mock('../../middleware/capability', () => ({
  requireCapability: (cap: string) => (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }, next: () => void) => {
    if (gate.denied.has(cap)) return res.status(403).json({ capability: cap });
    next();
  },
}));
vi.mock('../../services/mercadopago/payments', () => ({
  buildExternalReference: vi.fn(() => 'cobro:biz_1:11111111-1111-4111-8111-111111111111'),
  buildNotificationUrl: vi.fn(),
  recordCobro: vi.fn(),
}));

import { getMpStatus, saveMpConfig, disconnectMp, loadMpConfig } from '../../services/mercadopago/config';
import { testAccessToken, createPaymentPreference } from '../../services/mercadopago/client';
import { buildNotificationUrl, recordCobro } from '../../services/mercadopago/payments';
import { mercadopagoRouter } from '../../routes/mercadopago';
import { errorHandler } from '../../middleware/errorHandler';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

const JWT_SECRET = process.env.NEXTAUTH_SECRET || 'dev-secret';
const adminToken = jwt.sign({ userId: 'u1', businessId: 'biz_1', role: 'ADMIN' }, JWT_SECRET);
const userToken = jwt.sign({ userId: 'u2', businessId: 'biz_1', role: 'PROFESSIONAL' }, JWT_SECRET);
const clientToken = jwt.sign({ userId: 'u3', businessId: 'biz_1', role: 'CLIENT' }, JWT_SECRET);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/mercadopago', mercadopagoRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  gate.denied.clear();
});

describe('routes/mercadopago', () => {
  const app = buildApp();

  it('GET /status devuelve el estado', async () => {
    mock(getMpStatus).mockResolvedValue({ connected: true, enabled: true, currency: 'ARS' });
    const res = await request(app).get('/api/mercadopago/status').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
  });

  it('POST /connect rechaza token inválido (400)', async () => {
    mock(testAccessToken).mockResolvedValue(false);
    const res = await request(app).post('/api/mercadopago/connect').set('Authorization', `Bearer ${adminToken}`)
      .send({ accessToken: 'malo' });
    expect(res.status).toBe(400);
    expect(saveMpConfig).not.toHaveBeenCalled();
  });

  it('POST /connect valida y guarda con token correcto (normaliza moneda)', async () => {
    mock(testAccessToken).mockResolvedValue(true);
    mock(saveMpConfig).mockResolvedValue({ connected: true, enabled: true, currency: 'MXN' });
    const res = await request(app).post('/api/mercadopago/connect').set('Authorization', `Bearer ${adminToken}`)
      .send({ accessToken: 'APP_USR-x', currency: 'mxn' });
    expect(res.status).toBe(200);
    expect(saveMpConfig).toHaveBeenCalledWith('biz_1', { accessToken: 'APP_USR-x', currency: 'MXN' });
  });

  it('POST /connect rechaza a no-ADMIN (403)', async () => {
    const res = await request(app).post('/api/mercadopago/connect').set('Authorization', `Bearer ${userToken}`)
      .send({ accessToken: 'APP_USR-x' });
    expect(res.status).toBe(403);
  });

  it('POST /payment-link exige estar conectado (400)', async () => {
    mock(loadMpConfig).mockResolvedValue(null);
    const res = await request(app).post('/api/mercadopago/payment-link').set('Authorization', `Bearer ${userToken}`)
      .send({ amount: 100, description: 'Seña' });
    expect(res.status).toBe(400);
  });

  it('POST /payment-link genera el link cuando está conectado', async () => {
    mock(loadMpConfig).mockResolvedValue({ accessToken: 'APP_USR-x', currency: 'ARS', enabled: true });
    mock(createPaymentPreference).mockResolvedValue({ id: 'pref_1', initPoint: 'https://mpago.la/abc' });

    const res = await request(app).post('/api/mercadopago/payment-link').set('Authorization', `Bearer ${userToken}`)
      .send({ amount: 1500, description: 'Seña de turno' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ url: 'https://mpago.la/abc', id: 'pref_1' });
    expect(createPaymentPreference).toHaveBeenCalledWith('APP_USR-x', expect.objectContaining({
      title: 'Seña de turno', amount: 1500, currency: 'ARS',
    }));
  });

  it('POST /payment-link manda external_reference y notification_url propios y guarda el cobro', async () => {
    mock(loadMpConfig).mockResolvedValue({ accessToken: 'APP_USR-x', currency: 'ARS', enabled: true });
    mock(buildNotificationUrl).mockReturnValue('https://api.test/api/mercadopago/webhook/biz_1');
    mock(createPaymentPreference).mockResolvedValue({ id: 'pref_1', initPoint: 'https://mpago.la/abc' });

    const res = await request(app).post('/api/mercadopago/payment-link').set('Authorization', `Bearer ${userToken}`)
      .send({ amount: 1500, description: 'Seña de turno' });

    expect(res.body.autoRegister).toBe(true);
    expect(createPaymentPreference).toHaveBeenCalledWith('APP_USR-x', expect.objectContaining({
      externalReference: 'cobro:biz_1:11111111-1111-4111-8111-111111111111',
      notificationUrl: 'https://api.test/api/mercadopago/webhook/biz_1',
    }));
    expect(recordCobro).toHaveBeenCalledWith('biz_1', 'cobro:biz_1:11111111-1111-4111-8111-111111111111', expect.objectContaining({
      preferenceId: 'pref_1', amount: 1500, currency: 'ARS',
    }));
  });

  it('POST /payment-link avisa autoRegister=false si no hay URL pública para el webhook', async () => {
    mock(loadMpConfig).mockResolvedValue({ accessToken: 'APP_USR-x', currency: 'ARS', enabled: true });
    mock(buildNotificationUrl).mockReturnValue(undefined);
    mock(createPaymentPreference).mockResolvedValue({ id: 'pref_1', initPoint: 'https://mpago.la/abc' });
    const res = await request(app).post('/api/mercadopago/payment-link').set('Authorization', `Bearer ${userToken}`)
      .send({ amount: 10, description: 'x' });
    expect(res.body.autoRegister).toBe(false);
  });

  it('POST /webhook-secret guarda la clave (solo ADMIN, solo conectado)', async () => {
    mock(getMpStatus).mockResolvedValue({ connected: true, enabled: true, currency: 'ARS' });
    mock(saveMpConfig).mockResolvedValue({ connected: true, enabled: true, currency: 'ARS' });
    const res = await request(app).post('/api/mercadopago/webhook-secret').set('Authorization', `Bearer ${adminToken}`)
      .send({ webhookSecret: 'clave-falsa' });
    expect(res.status).toBe(200);
    expect(saveMpConfig).toHaveBeenCalledWith('biz_1', { webhookSecret: 'clave-falsa' });

    const denied = await request(app).post('/api/mercadopago/webhook-secret').set('Authorization', `Bearer ${userToken}`)
      .send({ webhookSecret: 'x' });
    expect(denied.status).toBe(403);
  });

  it('POST /payment-link rechaza a un CLIENT logueado y no crea nada en MercadoPago (403)', async () => {
    mock(loadMpConfig).mockResolvedValue({ accessToken: 'APP_USR-x', currency: 'ARS', enabled: true });
    const res = await request(app).post('/api/mercadopago/payment-link').set('Authorization', `Bearer ${clientToken}`)
      .send({ amount: 100, description: 'Phishing' });
    expect(res.status).toBe(403);
    expect(createPaymentPreference).not.toHaveBeenCalled();
    expect(recordCobro).not.toHaveBeenCalled();
  });

  it('POST /payment-link exige la capacidad "sales" (403 si el plan/rol no la tiene)', async () => {
    gate.denied.add('sales');
    const res = await request(app).post('/api/mercadopago/payment-link').set('Authorization', `Bearer ${userToken}`)
      .send({ amount: 100, description: 'x' });
    expect(res.status).toBe(403);
    expect(createPaymentPreference).not.toHaveBeenCalled();
  });

  it('GET /status no es para CLIENT (403)', async () => {
    const res = await request(app).get('/api/mercadopago/status').set('Authorization', `Bearer ${clientToken}`);
    expect(res.status).toBe(403);
    expect(getMpStatus).not.toHaveBeenCalled();
  });

  it('POST /payment-link tiene tope por negocio (429 al pasar de 30 por minuto)', async () => {
    process.env.TENANT_RL_FORCE = 'true';
    try {
      mock(loadMpConfig).mockResolvedValue({ accessToken: 'APP_USR-x', currency: 'ARS', enabled: true });
      mock(createPaymentPreference).mockResolvedValue({ id: 'pref_1', initPoint: 'https://mpago.la/abc' });
      const bizToken = jwt.sign({ userId: 'u9', businessId: 'biz_rl', role: 'PROFESSIONAL' }, JWT_SECRET);
      let last = 0;
      for (let i = 0; i < 31; i++) {
        last = (await request(app).post('/api/mercadopago/payment-link').set('Authorization', `Bearer ${bizToken}`)
          .send({ amount: 10, description: 'x' })).status;
      }
      expect(last).toBe(429);
      expect(createPaymentPreference).toHaveBeenCalledTimes(30);
    } finally {
      delete process.env.TENANT_RL_FORCE;
    }
  });

  it('POST /payment-link valida el body (monto > 0)', async () => {
    const res = await request(app).post('/api/mercadopago/payment-link').set('Authorization', `Bearer ${userToken}`)
      .send({ amount: 0, description: 'x' });
    expect(res.status).toBe(400);
  });

  it('POST /disconnect limpia la conexión', async () => {
    mock(disconnectMp).mockResolvedValue(undefined);
    const res = await request(app).post('/api/mercadopago/disconnect').set('Authorization', `Bearer ${adminToken}`).send();
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(false);
  });
});
