/**
 * Pruebas de integración de las rutas de Composio (`src/routes/composio.ts`):
 * status, connect (valida key + rol ADMIN) y disconnect. El servicio de config
 * y el cliente se mockean; auth por JWT real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../../services/composio/config', () => ({
  getCmpStatus: vi.fn(),
  saveCmpConfig: vi.fn(),
  disconnectCmp: vi.fn(),
}));
vi.mock('../../services/composio/client', () => ({
  testApiKey: vi.fn(),
}));

import { getCmpStatus, saveCmpConfig, disconnectCmp } from '../../services/composio/config';
import { testApiKey } from '../../services/composio/client';
import { composioRouter } from '../../routes/composio';
import { errorHandler } from '../../middleware/errorHandler';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

const JWT_SECRET = process.env.NEXTAUTH_SECRET || 'dev-secret';
const adminToken = jwt.sign({ userId: 'u1', businessId: 'biz_1', role: 'ADMIN' }, JWT_SECRET);
const userToken = jwt.sign({ userId: 'u2', businessId: 'biz_1', role: 'USER' }, JWT_SECRET);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/composio', composioRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => vi.clearAllMocks());

describe('routes/composio', () => {
  const app = buildApp();

  it('GET /status devuelve el estado', async () => {
    mock(getCmpStatus).mockResolvedValue({ connected: true, enabled: true });
    const res = await request(app).get('/api/composio/status').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: true, enabled: true });
  });

  it('GET /status exige autenticación', async () => {
    const res = await request(app).get('/api/composio/status');
    expect(res.status).toBe(401);
  });

  it('POST /connect rechaza key inválida (400)', async () => {
    mock(testApiKey).mockResolvedValue(false);
    const res = await request(app).post('/api/composio/connect').set('Authorization', `Bearer ${adminToken}`)
      .send({ apiKey: 'mala' });
    expect(res.status).toBe(400);
    expect(saveCmpConfig).not.toHaveBeenCalled();
  });

  it('POST /connect valida y guarda con key correcta', async () => {
    mock(testApiKey).mockResolvedValue(true);
    mock(saveCmpConfig).mockResolvedValue({ connected: true, enabled: true });
    const res = await request(app).post('/api/composio/connect').set('Authorization', `Bearer ${adminToken}`)
      .send({ apiKey: 'cmp_live_x' });
    expect(res.status).toBe(200);
    expect(saveCmpConfig).toHaveBeenCalledWith('biz_1', { apiKey: 'cmp_live_x' });
  });

  it('POST /connect rechaza a no-ADMIN (403)', async () => {
    const res = await request(app).post('/api/composio/connect').set('Authorization', `Bearer ${userToken}`)
      .send({ apiKey: 'cmp_live_x' });
    expect(res.status).toBe(403);
  });

  it('POST /connect valida el body (apiKey requerida)', async () => {
    const res = await request(app).post('/api/composio/connect').set('Authorization', `Bearer ${adminToken}`).send({});
    expect(res.status).toBe(400);
  });

  it('POST /disconnect limpia la conexión', async () => {
    mock(disconnectCmp).mockResolvedValue(undefined);
    const res = await request(app).post('/api/composio/disconnect').set('Authorization', `Bearer ${adminToken}`).send();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: false, enabled: false });
  });
});
