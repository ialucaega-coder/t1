/**
 * Recuperación automática de campañas trabadas (services/campaigns/send → failStalledCampaigns).
 * Con colas reales y cursor, el reaper retoma el envío con un runId nuevo en vez de fallarlo.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/prisma', () => ({
  prisma: { campaign: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() } },
}));
vi.mock('../../../lib/socket', () => ({ getIO: () => undefined }));
vi.mock('../../../services/whatsapp/client', () => ({ isConfigured: vi.fn(() => true), sendMessage: vi.fn() }));
vi.mock('../../../services/email', () => ({ sendGenericNotification: vi.fn() }));
const emitFailed = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('../../../services/campaigns/events', () => ({
  emitCampaignFailed: (...a: unknown[]) => emitFailed(...a),
  emitCampaignProgress: vi.fn(),
}));
let queues = true;
const enqueue = vi.fn(async (..._a: unknown[]) => "queued");
vi.mock('../../../lib/queue', () => ({
  defineQueue: vi.fn(),
  enqueue: (...a: unknown[]) => enqueue(...a),
  queuesEnabled: () => queues,
}));

import { prisma } from '../../../lib/prisma';
import { cache } from '../../../lib/cache';
import { sharedGet, sharedSet } from '../../../lib/sharedState';
import { failStalledCampaigns, STALLED_SENDING_MS, MAX_AUTO_RECOVERIES } from '../../../services/campaigns/send';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;
const BIZ = 'biz_1';
const NOW = new Date('2026-11-17T12:00:00Z');
const old = new Date(NOW.getTime() - STALLED_SENDING_MS - 60_000);
const TTL = 60_000;

const cursorKey = (run: string) => `campaign:${BIZ}:c9:${run}:cursor`;
const runKey = `campaign:${BIZ}:c9:run`;

async function seed(cursor = { processed: 40, enviados: 38, fallidos: 2, tries: 1, message: 'Hola' }) {
  await sharedSet(runKey, 'run-old', TTL);
  await sharedSet(cursorKey('run-old'), cursor, TTL);
}

beforeEach(() => {
  vi.clearAllMocks();
  cache.clear();
  queues = true;
  mock(prisma.campaign.findMany).mockResolvedValue([{ id: 'c9', businessId: BIZ, updatedAt: old }]);
  mock(prisma.campaign.updateMany).mockResolvedValue({ count: 1 });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('failStalledCampaigns: recuperación automática', () => {
  it('retoma desde el cursor con runId nuevo y NO la marca failed', async () => {
    await seed();

    expect(await failStalledCampaigns(NOW)).toBe(0);

    // Claim con el updatedAt leído; refleja lo ya enviado.
    expect(prisma.campaign.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.campaign.updateMany).toHaveBeenCalledWith({
      where: { id: 'c9', businessId: BIZ, status: 'sending', updatedAt: old },
      data: { sentCount: 38 },
    });
    expect(emitFailed).not.toHaveBeenCalled();

    // runId nuevo y cursor copiado (mismos conteos, intentos en 0, mismo mensaje).
    const newRun = await sharedGet<string>(runKey);
    expect(newRun).toBeTruthy();
    expect(newRun).not.toBe('run-old');
    expect(await sharedGet(cursorKey(newRun as string))).toEqual({
      processed: 40, enviados: 38, fallidos: 2, tries: 0, message: 'Hola',
    });

    expect(enqueue).toHaveBeenCalledTimes(1);
    const [queue, data] = enqueue.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(queue).toBe('campaign-send');
    expect(data).toEqual({ businessId: BIZ, id: 'c9', message: 'Hola', runId: newRun });
  });

  it('sin colas reales (sin Redis) no retoma: la marca failed como antes', async () => {
    queues = false;
    await seed();

    expect(await failStalledCampaigns(NOW)).toBe(1);
    expect(enqueue).not.toHaveBeenCalled();
    expect(emitFailed).toHaveBeenCalledWith(BIZ, 'c9', 'stalled');
  });

  it('sin cursor (perdido) no retoma: la marca failed', async () => {
    await sharedSet(runKey, 'run-old', TTL);

    expect(await failStalledCampaigns(NOW)).toBe(1);
    expect(enqueue).not.toHaveBeenCalled();
    expect(emitFailed).toHaveBeenCalledWith(BIZ, 'c9', 'stalled');
  });

  it('sin marca de envío vigente no retoma', async () => {
    expect(await failStalledCampaigns(NOW)).toBe(1);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it(`después de ${MAX_AUTO_RECOVERIES} retomas la marca failed (no reintenta para siempre)`, async () => {
    for (let i = 0; i < MAX_AUTO_RECOVERIES; i++) {
      await seed();
      expect(await failStalledCampaigns(NOW)).toBe(0);
    }
    expect(enqueue).toHaveBeenCalledTimes(MAX_AUTO_RECOVERIES);

    await seed();
    expect(await failStalledCampaigns(NOW)).toBe(1);
    expect(enqueue).toHaveBeenCalledTimes(MAX_AUTO_RECOVERIES);
    expect(emitFailed).toHaveBeenCalledWith(BIZ, 'c9', 'stalled');
  });

  it('si otra instancia la tomó o avanzó (claim count 0) no la retoma ni la falla', async () => {
    await seed();
    mock(prisma.campaign.updateMany).mockResolvedValue({ count: 0 });

    expect(await failStalledCampaigns(NOW)).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
    expect(emitFailed).not.toHaveBeenCalled();
    expect(prisma.campaign.updateMany).toHaveBeenCalledTimes(1);
  });

  it('si retomar lanza (p. ej. DB caída) cae al camino de siempre: failed', async () => {
    await seed();
    mock(prisma.campaign.updateMany).mockRejectedValueOnce(new Error('db')).mockResolvedValue({ count: 1 });
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await failStalledCampaigns(NOW)).toBe(1);
    expect(enqueue).not.toHaveBeenCalled();
    expect(emitFailed).toHaveBeenCalledWith(BIZ, 'c9', 'stalled');
    err.mockRestore();
  });
});
