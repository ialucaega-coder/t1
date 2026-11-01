/**
 * Pruebas del envío de campañas (services/campaigns/send): claim atómico, retomar
 * tras un fallo del job sin reenviar a quienes ya recibieron, y 'failed' al agotar
 * los intentos. Las colas corren inline (QUEUES_DISABLED en el setup).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    campaign: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
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

import { prisma } from '../../../lib/prisma';
import * as whatsapp from '../../../services/whatsapp/client';
import { cache } from '../../../lib/cache';
import { sendCampaign } from '../../../services/campaigns/send';

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
  });
});
