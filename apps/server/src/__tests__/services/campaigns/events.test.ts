/**
 * Evento `campaign:failed` (`services/campaigns/events.ts`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/prisma', () => ({ prisma: { campaign: { findFirst: vi.fn() } } }));
const emit = vi.fn();
const to = vi.fn(() => ({ emit }));
let io: { to: typeof to } | undefined;
vi.mock('../../../lib/socket', () => ({ getIO: () => io }));

import { prisma } from '../../../lib/prisma';
import { emitCampaignFailed, emitCampaignProgress } from '../../../services/campaigns/events';

const m = <T extends (...a: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

describe('emitCampaignProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    io = { to };
  });

  it('emite campaign:progress a la sala del negocio sin leer la DB', () => {
    const progress = { enviados: 25, fallidos: 2, procesados: 27, total: 100 };
    emitCampaignProgress('b1', 'c1', progress);
    expect(to).toHaveBeenCalledWith('business:b1');
    expect(emit).toHaveBeenCalledWith('campaign:progress', { campaignId: 'c1', progress });
    expect(prisma.campaign.findFirst).not.toHaveBeenCalled();
  });

  it('nunca lanza (sin socket o con el socket roto)', () => {
    io = undefined;
    expect(() => emitCampaignProgress('b1', 'c1', { enviados: 0, fallidos: 0, procesados: 0, total: 0 })).not.toThrow();
    emit.mockImplementationOnce(() => {
      throw new Error('socket');
    });
    io = { to };
    expect(() => emitCampaignProgress('b1', 'c1', { enviados: 0, fallidos: 0, procesados: 0, total: 0 })).not.toThrow();
  });
});

describe('emitCampaignFailed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    io = { to };
  });

  it('emite campaign:failed a la sala del negocio con { campaign, envio, reason }', async () => {
    const campaign = { id: 'c1', status: 'failed' };
    m(prisma.campaign.findFirst).mockResolvedValue(campaign);
    await emitCampaignFailed('b1', 'c1', 'retries_exhausted', { enviados: 3, fallidos: 1 });
    expect(to).toHaveBeenCalledWith('business:b1');
    expect(emit).toHaveBeenCalledWith('campaign:failed', {
      campaign,
      envio: { enviados: 3, fallidos: 1 },
      reason: 'retries_exhausted',
    });
  });

  it('scopea la lectura por negocio y no emite si la campaña no existe', async () => {
    m(prisma.campaign.findFirst).mockResolvedValue(null);
    await emitCampaignFailed('b1', 'c1', 'expired');
    expect(m(prisma.campaign.findFirst).mock.calls[0][0].where).toEqual({ id: 'c1', businessId: 'b1' });
    expect(emit).not.toHaveBeenCalled();
  });

  it('nunca lanza (sin socket o con la DB caída)', async () => {
    io = undefined;
    m(prisma.campaign.findFirst).mockResolvedValue({ id: 'c1' });
    await expect(emitCampaignFailed('b1', 'c1', 'expired')).resolves.toBeUndefined();
    m(prisma.campaign.findFirst).mockRejectedValue(new Error('db'));
    await expect(emitCampaignFailed('b1', 'c1', 'expired')).resolves.toBeUndefined();
  });
});
