/**
 * Pruebas de integración de las rutas de Cal.com (`src/routes/calcom.ts`):
 * status, connect (valida API key + rol ADMIN), disconnect. El servicio de
 * config y el cliente se mockean; auth por JWT real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../../services/calcom/config', () => ({
  getCalcomStatus: vi.fn(),
  saveCalcomConfig: vi.fn(),
  disconnectCalcom: vi.fn(),
  loadCalcomConfig: vi.fn(),
}));
vi.mock('../../services/calcom/client', () => ({
  testApiKey: vi.fn(),
  listEventTypes: vi.fn(),
}));

import { getCalcomStatus, saveCalcomConfig, disconnectCalcom } from '../../services/calcom/config';
import { testApiKey } from '../../services/calcom/client';
import { calcomRouter } from '../../routes/calcom';
import { errorHandler } from '../../middleware/errorHandler';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

const JWT_SECRET = process.env.NEXTAUTH_SECRET || 'dev-secret';
const adminToken = jwt.sign({ userId: 'u1', businessId: 'biz_1', role: 'ADMIN' }, JWT_SECRET);
const userToken = jwt.sign({ userId: 'u2', businessId: 'biz_1', role: 'USER' }, JWT_SECRET);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/calcom', calcomRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => vi.clearAllMocks());

describe('routes/calcom', () => {
  const app = buildApp();

  it('GET /status devuelve el estado de conexión', async () => {
    mock(getCalcomStatus).mockResolvedValue({ connected: true, enabled: true, eventTypeId: 7 });
    const res = await request(app).get('/api/calcom/status').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: true, enabled: true, eventTypeId: 7 });
  });

  it('GET /status exige autenticación', async () => {
    const res = await request(app).get('/api/calcom/status');
    expect(res.status).toBe(401);
  });

  it('POST /connect rechaza (400) una API key inválida', async () => {
    mock(testApiKey).mockResolvedValue(false);
    const res = await request(app).post('/api/calcom/connect').set('Authorization', `Bearer ${adminToken}`)
      .send({ apiKey: 'mala' });
    expect(res.status).toBe(400);
    expect(saveCalcomConfig).not.toHaveBeenCalled();
  });

  it('POST /connect valida y guarda con API key correcta', async () => {
    mock(testApiKey).mockResolvedValue(true);
    mock(saveCalcomConfig).mockResolvedValue({ connected: true, enabled: true, eventTypeId: 5 });
    const res = await request(app).post('/api/calcom/connect').set('Authorization', `Bearer ${adminToken}`)
      .send({ apiKey: 'cal_live_x', eventTypeId: 5 });
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
    expect(saveCalcomConfig).toHaveBeenCalledWith('biz_1', { apiKey: 'cal_live_x', eventTypeId: 5 });
  });

  it('POST /connect rechaza a un usuario sin rol ADMIN (403)', async () => {
    const res = await request(app).post('/api/calcom/connect').set('Authorization', `Bearer ${userToken}`)
      .send({ apiKey: 'cal_live_x' });
    expect(res.status).toBe(403);
  });

  it('POST /connect valida el body (apiKey requerida)', async () => {
    const res = await request(app).post('/api/calcom/connect').set('Authorization', `Bearer ${adminToken}`).send({});
    expect(res.status).toBe(400);
  });

  it('POST /disconnect limpia la conexión', async () => {
    mock(disconnectCalcom).mockResolvedValue(undefined);
    const res = await request(app).post('/api/calcom/disconnect').set('Authorization', `Bearer ${adminToken}`).send();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: false, enabled: false, eventTypeId: null });
    expect(disconnectCalcom).toHaveBeenCalledWith('biz_1');
  });
});
