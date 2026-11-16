/**
 * Webhook de Telegram con cola (routes/telegram.ts): el webhook valida y encola; el
 * worker (processTelegramUpdate) resuelve el token y procesa. La cola se mockea para
 * simular Redis activo.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../lib/prisma', () => ({
  prisma: { connection: { findFirst: vi.fn() } },
}));
vi.mock('../../services/telegram/bot', () => ({
  createBot: vi.fn(),
  stopBot: vi.fn(),
  setWebhook: vi.fn(),
  handleUpdate: vi.fn(),
  getBotInfo: vi.fn(),
}));
vi.mock('../../lib/queue', () => ({
  defineQueue: vi.fn(),
  enqueue: vi.fn(async () => 'queued'),
}));

import { prisma } from '../../lib/prisma';
import { handleUpdate } from '../../services/telegram/bot';
import { defineQueue, enqueue } from '../../lib/queue';
import { INBOUND_RETRY } from '../../services/channels/inboundRetry';
import { errorHandler } from '../../middleware/errorHandler';
import { telegramRouter, processTelegramUpdate } from '../../routes/telegram';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

// defineQueue corre al importar el módulo (antes de que beforeEach limpie los mocks).
const registeredQueues = [...mock(defineQueue).mock.calls];

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/telegram', telegramRouter);
  app.use(errorHandler);
  return app;
}

const connection = (config: Record<string, unknown>) => ({
  id: 'conn_1',
  businessId: 'biz_1',
  type: 'TELEGRAM',
  isActive: true,
  config,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Telegram — webhook con cola', () => {
  const app = buildApp();

  it('registra la cola telegram-update con su handler', () => {
    expect(registeredQueues).toHaveLength(1);
    expect(registeredQueues[0][0]).toBe('telegram-update');
    expect(registeredQueues[0][1]).toBe(processTelegramUpdate);
  });

  it('valida, encola con jobId por update_id y responde 200 sin procesar en el request', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue(connection({ botToken: '123:ABC' }));

    const res = await request(app).post('/api/telegram/webhook/biz_1').query({ token: '123:ABC' }).send({ update_id: 42, message: { text: 'hola' } });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const [name, data, opts] = mock(enqueue).mock.calls[0];
    expect(name).toBe('telegram-update');
    expect(data).toEqual({ businessId: 'biz_1', update: { update_id: 42, message: { text: 'hola' } } });
    expect(opts).toEqual({ jobId: 'tg_biz_1_42', ...INBOUND_RETRY });
    expect(opts.jobId).not.toContain(':');
    expect(handleUpdate).not.toHaveBeenCalled();
  });

  it('el token del bot NUNCA viaja por la cola (Redis)', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue(connection({ webhookSecret: 'sek', botTokenEnc: 'cifrado' }));

    await request(app).post('/api/telegram/webhook/biz_1').set('x-telegram-bot-api-secret-token', 'sek').send({ update_id: 1 });

    const payload = JSON.stringify(mock(enqueue).mock.calls[0][1]);
    expect(payload).not.toContain('cifrado');
    expect(payload).not.toContain('sek');
  });

  it('un update sin update_id se encola sin jobId (sin dedupe)', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue(connection({ botToken: '123:ABC' }));
    await request(app).post('/api/telegram/webhook/biz_1').query({ token: '123:ABC' }).send({ foo: 'bar' });
    expect(mock(enqueue).mock.calls[0][2]).toEqual({ ...INBOUND_RETRY });
  });

  it('no encola nada si la autenticación falla', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue(connection({ botToken: '123:ABC' }));
    const res = await request(app).post('/api/telegram/webhook/biz_1').query({ token: 'otro' }).send({ update_id: 1 });
    expect(res.status).toBe(403);
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe('Telegram — worker', () => {
  it('relee la conexión, descifra el token y procesa el update', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue(connection({ botToken: '123:ABC' }));
    mock(handleUpdate).mockResolvedValue(undefined);

    await processTelegramUpdate({ businessId: 'biz_1', update: { update_id: 9 } });

    expect(handleUpdate).toHaveBeenCalledWith('biz_1', { update_id: 9 }, '123:ABC');
  });

  it('si la conexión ya no está activa, descarta el update sin error', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue(null);
    await expect(processTelegramUpdate({ businessId: 'biz_1', update: { update_id: 9 } })).resolves.toBeUndefined();
    expect(handleUpdate).not.toHaveBeenCalled();
  });

  it('un fallo al leer la conexión (antes de que el bot haga nada) SÍ se relanza para que la cola reintente', async () => {
    mock(prisma.connection.findFirst).mockRejectedValue(new Error('db caída'));

    await expect(processTelegramUpdate({ businessId: 'biz_1', update: { update_id: 9 } })).rejects.toThrow('db caída');
    expect(handleUpdate).not.toHaveBeenCalled();
  });

  it('un error al procesar no se propaga (no se reintenta: evita doble respuesta)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    mock(prisma.connection.findFirst).mockResolvedValue(connection({ botToken: '123:ABC' }));
    mock(handleUpdate).mockRejectedValue(new Error('boom'));

    await expect(processTelegramUpdate({ businessId: 'biz_1', update: {} })).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
