/**
 * Pruebas de integración de las rutas de ManyChat (`src/routes/manychat.ts`):
 * status, connect (valida key + rol ADMIN) y disconnect. El servicio de config
 * y el cliente se mockean; auth por JWT real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../../services/manychat/config', () => ({
  getMcStatus: vi.fn(),
  saveMcConfig: vi.fn(),
  disconnectMc: vi.fn(),
  verifyMcWebhookToken: vi.fn(),
  regenerateMcWebhookToken: vi.fn(),
}));
vi.mock('../../services/manychat/client', () => ({
  testApiKey: vi.fn(),
}));
vi.mock('../../services/chatbot', () => ({
  processMessage: vi.fn(),
}));

import {
  getMcStatus,
  saveMcConfig,
  disconnectMc,
  verifyMcWebhookToken,
  regenerateMcWebhookToken,
} from '../../services/manychat/config';
import { testApiKey } from '../../services/manychat/client';
import { processMessage } from '../../services/chatbot';
import { manychatRouter } from '../../routes/manychat';
import { errorHandler } from '../../middleware/errorHandler';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

const JWT_SECRET = process.env.NEXTAUTH_SECRET || 'dev-secret';
const adminToken = jwt.sign({ userId: 'u1', businessId: 'biz_1', role: 'ADMIN' }, JWT_SECRET);
const userToken = jwt.sign({ userId: 'u2', businessId: 'biz_1', role: 'USER' }, JWT_SECRET);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/manychat', manychatRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => vi.clearAllMocks());

describe('routes/manychat', () => {
  const app = buildApp();

  it('GET /status devuelve el estado', async () => {
    mock(getMcStatus).mockResolvedValue({ connected: true, enabled: true });
    const res = await request(app).get('/api/manychat/status').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: true, enabled: true });
  });

  it('GET /status exige autenticación', async () => {
    const res = await request(app).get('/api/manychat/status');
    expect(res.status).toBe(401);
  });

  it('POST /connect rechaza key inválida (400)', async () => {
    mock(testApiKey).mockResolvedValue(false);
    const res = await request(app).post('/api/manychat/connect').set('Authorization', `Bearer ${adminToken}`)
      .send({ apiKey: 'mala' });
    expect(res.status).toBe(400);
    expect(saveMcConfig).not.toHaveBeenCalled();
  });

  it('POST /connect valida y guarda con key correcta', async () => {
    mock(testApiKey).mockResolvedValue(true);
    mock(saveMcConfig).mockResolvedValue({ connected: true, enabled: true });
    const res = await request(app).post('/api/manychat/connect').set('Authorization', `Bearer ${adminToken}`)
      .send({ apiKey: 'mc_live_x' });
    expect(res.status).toBe(200);
    expect(saveMcConfig).toHaveBeenCalledWith('biz_1', { apiKey: 'mc_live_x' });
  });

  it('POST /connect rechaza a no-ADMIN (403)', async () => {
    const res = await request(app).post('/api/manychat/connect').set('Authorization', `Bearer ${userToken}`)
      .send({ apiKey: 'mc_live_x' });
    expect(res.status).toBe(403);
  });

  it('POST /connect valida el body (apiKey requerida)', async () => {
    const res = await request(app).post('/api/manychat/connect').set('Authorization', `Bearer ${adminToken}`).send({});
    expect(res.status).toBe(400);
  });

  it('POST /disconnect limpia la conexión', async () => {
    mock(disconnectMc).mockResolvedValue(undefined);
    const res = await request(app).post('/api/manychat/disconnect').set('Authorization', `Bearer ${adminToken}`).send();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: false, enabled: false });
  });

  it('POST /regenerate-token rota el token (ADMIN)', async () => {
    mock(regenerateMcWebhookToken).mockResolvedValue({ connected: true, enabled: true, webhookToken: 'nuevo_tok' });
    const res = await request(app).post('/api/manychat/regenerate-token').set('Authorization', `Bearer ${adminToken}`).send();
    expect(res.status).toBe(200);
    expect(res.body.webhookToken).toBe('nuevo_tok');
  });

  it('POST /regenerate-token da 400 si no está conectado', async () => {
    mock(regenerateMcWebhookToken).mockRejectedValue(new Error('ManyChat no está conectado'));
    const res = await request(app).post('/api/manychat/regenerate-token').set('Authorization', `Bearer ${adminToken}`).send();
    expect(res.status).toBe(400);
  });

  it('POST /regenerate-token rechaza a no-ADMIN (403)', async () => {
    const res = await request(app).post('/api/manychat/regenerate-token').set('Authorization', `Bearer ${userToken}`).send();
    expect(res.status).toBe(403);
    expect(regenerateMcWebhookToken).not.toHaveBeenCalled();
  });
});

describe('routes/manychat — webhook entrante', () => {
  const app = buildApp();

  it('procesa el mensaje y responde en Dynamic Block v2 (token por header)', async () => {
    mock(verifyMcWebhookToken).mockResolvedValue(true);
    mock(processMessage).mockResolvedValue({ text: '¡Hola! ¿En qué te ayudo?', intent: 'FAQ', actions: [], conversationId: 'conv_9' });

    const res = await request(app)
      .post('/api/manychat/webhook/biz_1')
      .set('x-webhook-token', 'tok_ok')
      .send({ text: 'hola', subscriberId: 'sub_1', name: 'Ana' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      version: 'v2',
      content: { messages: [{ type: 'text', text: '¡Hola! ¿En qué te ayudo?' }] },
      conversationId: 'conv_9',
    });
    expect(verifyMcWebhookToken).toHaveBeenCalledWith('biz_1', 'tok_ok');
    expect(processMessage).toHaveBeenCalledWith('biz_1', 'hola', 'MESSENGER', expect.objectContaining({ contactName: 'Ana' }));
  });

  it('acepta el token por query string', async () => {
    mock(verifyMcWebhookToken).mockResolvedValue(true);
    mock(processMessage).mockResolvedValue({ text: 'ok', intent: 'FAQ', actions: [], conversationId: 'c1' });

    const res = await request(app)
      .post('/api/manychat/webhook/biz_1?token=tok_q')
      .send({ last_input_text: 'consulta', user_id: 42 });

    expect(res.status).toBe(200);
    expect(verifyMcWebhookToken).toHaveBeenCalledWith('biz_1', 'tok_q');
    expect(processMessage).toHaveBeenCalledWith('biz_1', 'consulta', 'MESSENGER', expect.objectContaining({ contactName: 'ManyChat 42' }));
  });

  it('rechaza token inválido con 401 y no llama al chatbot', async () => {
    mock(verifyMcWebhookToken).mockResolvedValue(false);
    const res = await request(app)
      .post('/api/manychat/webhook/biz_1')
      .set('x-webhook-token', 'mal')
      .send({ text: 'hola' });

    expect(res.status).toBe(401);
    expect(processMessage).not.toHaveBeenCalled();
  });

  it('sin texto responde cortésmente sin llamar al chatbot', async () => {
    mock(verifyMcWebhookToken).mockResolvedValue(true);
    const res = await request(app)
      .post('/api/manychat/webhook/biz_1')
      .set('x-webhook-token', 'tok_ok')
      .send({ text: '   ', subscriberId: 'sub_1' });

    expect(res.status).toBe(200);
    expect(res.body.version).toBe('v2');
    expect(res.body.content.messages[0].text).toContain('texto');
    expect(processMessage).not.toHaveBeenCalled();
  });

  it('si el chatbot falla no devuelve 500 (responde Dynamic Block de cortesía)', async () => {
    mock(verifyMcWebhookToken).mockResolvedValue(true);
    mock(processMessage).mockRejectedValue(new Error('boom'));
    const res = await request(app)
      .post('/api/manychat/webhook/biz_1')
      .set('x-webhook-token', 'tok_ok')
      .send({ text: 'hola' });

    expect(res.status).toBe(200);
    expect(res.body.version).toBe('v2');
    expect(res.body.content.messages[0].type).toBe('text');
  });
});
