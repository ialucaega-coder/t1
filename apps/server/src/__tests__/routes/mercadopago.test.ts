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

import { getMpStatus, saveMpConfig, disconnectMp, loadMpConfig } from '../../services/mercadopago/config';
import { testAccessToken, createPaymentPreference } from '../../services/mercadopago/client';
import { mercadopagoRouter } from '../../routes/mercadopago';
import { errorHandler } from '../../middleware/errorHandler';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

const JWT_SECRET = process.env.NEXTAUTH_SECRET || 'dev-secret';
const adminToken = jwt.sign({ userId: 'u1', businessId: 'biz_1', role: 'ADMIN' }, JWT_SECRET);
const userToken = jwt.sign({ userId: 'u2', businessId: 'biz_1', role: 'USER' }, JWT_SECRET);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/mercadopago', mercadopagoRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => vi.clearAllMocks());

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
    expect(res.body).toEqual({ url: 'https://mpago.la/abc', id: 'pref_1' });
    expect(createPaymentPreference).toHaveBeenCalledWith('APP_USR-x', expect.objectContaining({
      title: 'Seña de turno', amount: 1500, currency: 'ARS',
    }));
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
