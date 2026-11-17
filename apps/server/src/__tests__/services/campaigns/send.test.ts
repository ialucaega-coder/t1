/**
 * Pruebas del envío de campañas (services/campaigns/send): claim atómico, retomar
 * tras un fallo del job sin reenviar a quienes ya recibieron, y 'failed' al agotar
 * los intentos. Las colas corren inline (QUEUES_DISABLED en el setup).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    campaign: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    booking: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    business: { findUnique: vi.fn() },
  },
}));
vi.mock('../../../lib/socket', () => ({ getIO: () => undefined }));
vi.mock('../../../services/whatsapp/client', () => ({
  isConfigured: vi.fn(() => true),
  sendMessage: vi.fn(async () => 'SID'),
}));
vi.mock('../../../services/email', () => ({ sendGenericNotification: vi.fn(async () => true) }));
const emitFailed = vi.fn(async () => undefined);
vi.mock('../../../services/campaigns/events', () => ({ emitCampaignFailed: (...a: unknown[]) => (emitFailed as (...x: unknown[]) => unknown)(...a) }));

import { prisma } from '../../../lib/prisma';
import * as whatsapp from '../../../services/whatsapp/client';
import { cache } from '../../../lib/cache';
import { sendCampaign, failStalledCampaigns, STALLED_SENDING_MS } from '../../../services/campaigns/send';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;
const BIZ = 'biz_1';

const users = [
  { id: 'u1', name: 'A', email: null, phone: '+5491100000001' },
  { id: 'u2', name: 'B', email: null, phone: '+5491100000002' },
];

beforeEach(() => {
  vi.clearAllMocks();
  cache.clear();
  mock(prisma.campaign.updateMany).mockResolvedValue({ count: 1 });
  mock(prisma.campaign.findFirst).mockResolvedValue({
    id: 'c1', status: 'sending', channel: 'whatsapp', name: 'Promo', description: 'Hola',
  });
  mock(prisma.campaign.update).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'c1', ...data }));
  mock(prisma.booking.findMany).mockResolvedValue([{ clientId: 'u2' }, { clientId: 'u1' }]);
  mock(prisma.business.findUnique).mockResolvedValue({ whatsappNumber: null });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('services/campaigns/send', () => {
  it('claim atómico: si ya estaba enviada/en envío lanza 400 sin enviar nada', async () => {
    mock(prisma.campaign.updateMany).mockResolvedValue({ count: 0 });
    mock(prisma.campaign.findFirst).mockResolvedValue({ id: 'c1' });
    await expect(sendCampaign(BIZ, 'c1')).rejects.toMatchObject({ statusCode: 400 });
    expect(whatsapp.sendMessage).not.toHaveBeenCalled();
  });

  it('el claim manual excluye sent, sending y cancelled', async () => {
    mock(prisma.user.findMany).mockResolvedValue(users);
    await sendCampaign(BIZ, 'c1');
    expect(mock(prisma.campaign.updateMany).mock.calls[0][0].where).toEqual({
      id: 'c1', businessId: BIZ, status: { notIn: ['sent', 'sending', 'cancelled'] },
    });
  });

  it('el claim del scheduler exige status scheduled con fecha vencida', async () => {
    mock(prisma.user.findMany).mockResolvedValue(users);
    await sendCampaign(BIZ, 'c1', undefined, { scheduledOnly: true });
    const where = mock(prisma.campaign.updateMany).mock.calls[0][0].where;
    expect(where).toMatchObject({ id: 'c1', businessId: BIZ, status: 'scheduled' });
    expect(where.scheduledAt.lte).toBeInstanceOf(Date);
  });

  it('envía a todos y deja la campaña en sent con el conteo', async () => {
    mock(prisma.user.findMany).mockResolvedValue(users);
    const res = await sendCampaign(BIZ, 'c1');
    expect(res.envio).toEqual({ enviados: 2, fallidos: 0, canalSoportado: true });
    expect(prisma.campaign.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { status: 'sent', sentCount: 2 } }),
    );
  });

  it('si el job falla después de enviar, el reintento NO reenvía a quienes ya recibieron', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mock(prisma.user.findMany).mockResolvedValue(users);
    // El cierre de la campaña (update final) revienta una vez: el job lanza con los
    // 2 mensajes ya enviados y BullMQ/inline lo reintenta.
    mock(prisma.campaign.update).mockRejectedValueOnce(new Error('db down'));

    const p = sendCampaign(BIZ, 'c1');
    await vi.advanceTimersByTimeAsync(60_000);
    const res = await p;

    // Cada destinatario recibió el mensaje UNA sola vez, aunque el job corrió 2 veces.
    expect(whatsapp.sendMessage).toHaveBeenCalledTimes(2);
    expect(res.envio).toEqual({ enviados: 2, fallidos: 0, canalSoportado: true });
    expect(prisma.campaign.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { status: 'sent', sentCount: 2 } }),
    );
  });

  it('al agotar los intentos la campaña pasa a failed (no queda en sending)', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mock(prisma.user.findMany).mockRejectedValue(new Error('db down'));

    const p = sendCampaign(BIZ, 'c1');
    await vi.advanceTimersByTimeAsync(120_000);
    await p;

    expect(prisma.campaign.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }),
    );
    expect(emitFailed).toHaveBeenCalledTimes(1);
    expect(emitFailed).toHaveBeenCalledWith(BIZ, 'c1', 'retries_exhausted', { enviados: 0, fallidos: 0 });
  });

  it('un envío exitoso no emite campaign:failed', async () => {
    mock(prisma.user.findMany).mockResolvedValue(users);
    await sendCampaign(BIZ, 'c1');
    expect(emitFailed).not.toHaveBeenCalled();
  });

  it('una excepción DESPUÉS del claim deja la campaña en failed (no queda sending para siempre)', async () => {
    // El claim (updateMany) funciona; leer la campaña revienta.
    mock(prisma.campaign.findFirst).mockRejectedValueOnce(new Error('db down'));

    await expect(sendCampaign(BIZ, 'c1')).rejects.toThrow('db down');

    expect(prisma.campaign.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'c1', businessId: BIZ, status: 'sending' },
      data: { status: 'failed' },
    });
    expect(emitFailed).toHaveBeenCalledWith(BIZ, 'c1', 'error');
  });

  it('un 400 del claim (ya enviada) NO marca la campaña como failed', async () => {
    mock(prisma.campaign.updateMany).mockResolvedValueOnce({ count: 0 });
    mock(prisma.campaign.findFirst).mockResolvedValueOnce({ id: 'c1' });

    await expect(sendCampaign(BIZ, 'c1')).rejects.toThrow('Campaign already sent');

    expect(prisma.campaign.updateMany).toHaveBeenCalledTimes(1);
    expect(emitFailed).not.toHaveBeenCalled();
  });
});

describe('services/campaigns/send: envío obsoleto, latido y cursor (M2)', () => {
  it('si la campaña ya no está sending (reaper/cancelación) el job NO envía nada ni la marca failed', async () => {
    mock(prisma.user.findMany).mockResolvedValue(users);
    // La lectura de la campaña funciona, pero la guarda status:'sending' no encuentra fila.
    mock(prisma.campaign.findFirst).mockImplementation(async ({ where }: { where: { status?: string } }) =>
      where.status === 'sending' ? null : { id: 'c1', status: 'failed', channel: 'whatsapp', name: 'Promo', description: 'Hola' }
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await sendCampaign(BIZ, 'c1');

    expect(whatsapp.sendMessage).not.toHaveBeenCalled();
    expect(prisma.campaign.update).not.toHaveBeenCalled();
    expect(emitFailed).not.toHaveBeenCalled();
    // Solo el claim: no hay ningún updateMany a failed/sent.
    expect(prisma.campaign.updateMany).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('el cierre usa guarda status:sending: si ya no lo estaba no la pisa ni reintenta (no duplica envíos)', async () => {
    mock(prisma.user.findMany).mockResolvedValue(users);
    mock(prisma.campaign.update).mockRejectedValue(Object.assign(new Error('no row'), { code: 'P2025' }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await sendCampaign(BIZ, 'c1');

    expect(prisma.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c1', businessId: BIZ, status: 'sending' } })
    );
    // Cada destinatario recibió el mensaje UNA vez (la obsolescencia no se reintenta).
    expect(whatsapp.sendMessage).toHaveBeenCalledTimes(2);
    expect(emitFailed).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('latido por tiempo: toca updatedAt de la campaña sending aunque no lleguen a 25 destinatarios', async () => {
    vi.useFakeTimers();
    mock(prisma.user.findMany).mockResolvedValue(users);
    mock(whatsapp.sendMessage).mockImplementation(async () => {
      vi.advanceTimersByTime(61_000); // cada envío "tarda" más de un minuto
      return 'SID';
    });

    await sendCampaign(BIZ, 'c1');

    expect(prisma.campaign.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', businessId: BIZ, status: 'sending' },
      data: { sentCount: 1 },
    });
  });

  it('si el latido ve que la campaña ya no está sending, corta el envío (no sigue mandando)', async () => {
    vi.useFakeTimers();
    mock(prisma.user.findMany).mockResolvedValue(users);
    mock(prisma.campaign.updateMany).mockResolvedValueOnce({ count: 1 }).mockResolvedValue({ count: 0 });
    mock(whatsapp.sendMessage).mockImplementation(async () => {
      vi.advanceTimersByTime(61_000);
      return 'SID';
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await sendCampaign(BIZ, 'c1');

    expect(whatsapp.sendMessage).toHaveBeenCalledTimes(1);
    expect(emitFailed).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('un reenvío reemplaza al envío viejo: el job viejo (otro runId) se corta al ver que ya no es el vigente', async () => {
    vi.useFakeTimers();
    mock(prisma.user.findMany).mockResolvedValue(users);
    mock(whatsapp.sendMessage).mockImplementation(async () => {
      // Mientras este job corre, un reenvío nuevo toma el envío vigente de la campaña.
      cache.set(`ss:campaign:${BIZ}:c1:run`, 'run-nuevo', 3_600_000);
      vi.advanceTimersByTime(61_000);
      return 'SID';
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await sendCampaign(BIZ, 'c1');

    expect(whatsapp.sendMessage).toHaveBeenCalledTimes(1);
    expect(prisma.campaign.update).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('no borra el cursor de un job aún vivo: un envío nuevo usa su propio cursor', async () => {
    mock(prisma.user.findMany).mockResolvedValue(users);
    const liveCursor = { processed: 1, enviados: 1, fallidos: 0, tries: 1 };
    cache.set(`ss:campaign:${BIZ}:c1:run-viejo:cursor`, liveCursor, 60_000);
    // Y el cursor sin runId de versiones anteriores tampoco se toca.
    cache.set(`ss:campaign:${BIZ}:c1:cursor`, liveCursor, 60_000);

    await sendCampaign(BIZ, 'c1');

    expect(cache.get(`ss:campaign:${BIZ}:c1:run-viejo:cursor`)).toEqual(liveCursor);
    expect(cache.get(`ss:campaign:${BIZ}:c1:cursor`)).toEqual(liveCursor);
    // El envío nuevo arrancó de cero: mandó a los 2 destinatarios.
    expect(whatsapp.sendMessage).toHaveBeenCalledTimes(2);
  });
});

describe('failStalledCampaigns (reaper)', () => {
  const NOW = new Date('2026-11-17T12:00:00Z');
  const old = new Date(NOW.getTime() - STALLED_SENDING_MS - 60_000);

  it('busca campañas sending sin avance hace más de 30 min y las pasa a failed', async () => {
    mock(prisma.campaign.findMany).mockResolvedValue([{ id: 'c9', businessId: BIZ, updatedAt: old }]);

    const n = await failStalledCampaigns(NOW);

    expect(n).toBe(1);
    expect(mock(prisma.campaign.findMany).mock.calls[0][0].where).toEqual({
      status: 'sending',
      updatedAt: { lt: new Date(NOW.getTime() - STALLED_SENDING_MS) },
    });
    // El updatedAt leído va en el WHERE: si avanzó entre medio, no se pisa.
    expect(prisma.campaign.updateMany).toHaveBeenCalledWith({
      where: { id: 'c9', businessId: BIZ, status: 'sending', updatedAt: old },
      data: { status: 'failed' },
    });
    expect(emitFailed).toHaveBeenCalledWith(BIZ, 'c9', 'stalled');
  });

  it('si la campaña avanzó entre el listado y el UPDATE (count 0) no la marca ni emite', async () => {
    mock(prisma.campaign.findMany).mockResolvedValue([{ id: 'c9', businessId: BIZ, updatedAt: old }]);
    mock(prisma.campaign.updateMany).mockResolvedValue({ count: 0 });

    expect(await failStalledCampaigns(NOW)).toBe(0);
    expect(emitFailed).not.toHaveBeenCalled();
  });

  it('sin campañas trabadas no toca nada', async () => {
    mock(prisma.campaign.findMany).mockResolvedValue([]);
    expect(await failStalledCampaigns(NOW)).toBe(0);
    expect(prisma.campaign.updateMany).not.toHaveBeenCalled();
  });
});
