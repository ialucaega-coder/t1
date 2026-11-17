/**
 * Despacho de campañas programadas (`services/campaigns/dispatch.ts`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/prisma', () => ({
  prisma: { campaign: { findMany: vi.fn(), updateMany: vi.fn() } },
}));
const sendCampaign = vi.fn();
const failStalled = vi.fn();
vi.mock('../../../services/campaigns/send', () => ({
  sendCampaign: (...a: unknown[]) => sendCampaign(...a),
  failStalledCampaigns: (...a: unknown[]) => failStalled(...a),
}));
const emitFailed = vi.fn();
vi.mock('../../../services/campaigns/events', () => ({ emitCampaignFailed: (...a: unknown[]) => emitFailed(...a) }));
const tryLock = vi.fn();
vi.mock('../../../lib/sharedState', () => ({ sharedTryLock: (...a: unknown[]) => tryLock(...a) }));

import { prisma } from '../../../lib/prisma';
import { AppError } from '../../../middleware/errorHandler';
import { dispatchDueCampaigns, MAX_LATE_MS } from '../../../services/campaigns/dispatch';

const m = <T extends (...a: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;
const NOW = new Date('2026-11-16T15:00:00Z');
const at = (msAgo: number) => new Date(NOW.getTime() - msAgo);

describe('dispatchDueCampaigns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tryLock.mockResolvedValue(true);
    failStalled.mockResolvedValue(0);
  });

  it('envía las vencidas con claim scheduledOnly', async () => {
    m(prisma.campaign.findMany).mockResolvedValue([{ id: 'c1', businessId: 'b1', scheduledAt: at(60_000) }]);
    sendCampaign.mockResolvedValue({});
    const r = await dispatchDueCampaigns(NOW);
    expect(r).toEqual({ due: 1, sent: 1, expired: 0, skipped: 0 });
    expect(sendCampaign).toHaveBeenCalledWith('b1', 'c1', undefined, { scheduledOnly: true });
  });

  it('solo busca status scheduled con fecha vencida', async () => {
    m(prisma.campaign.findMany).mockResolvedValue([]);
    await dispatchDueCampaigns(NOW);
    expect(m(prisma.campaign.findMany).mock.calls[0][0].where).toEqual({ status: 'scheduled', scheduledAt: { lte: NOW } });
  });

  it('una campaña muy atrasada pasa a failed y NO se envía', async () => {
    m(prisma.campaign.findMany).mockResolvedValue([{ id: 'c1', businessId: 'b1', scheduledAt: at(MAX_LATE_MS + 1000) }]);
    m(prisma.campaign.updateMany).mockResolvedValue({ count: 1 });
    const r = await dispatchDueCampaigns(NOW);
    expect(r.expired).toBe(1);
    expect(sendCampaign).not.toHaveBeenCalled();
    expect(m(prisma.campaign.updateMany).mock.calls[0][0].data).toEqual({ status: 'failed' });
    expect(emitFailed).toHaveBeenCalledWith('b1', 'c1', 'expired');
  });

  it('al vencerla pasa a failed SOLO si scheduledAt sigue igual (no pisa una campaña reprogramada)', async () => {
    const scheduledAt = at(MAX_LATE_MS + 1000);
    m(prisma.campaign.findMany).mockResolvedValue([{ id: 'c1', businessId: 'b1', scheduledAt }]);
    m(prisma.campaign.updateMany).mockResolvedValue({ count: 0 });

    await dispatchDueCampaigns(NOW);

    expect(m(prisma.campaign.updateMany).mock.calls[0][0].where).toEqual({
      id: 'c1', businessId: 'b1', status: 'scheduled', scheduledAt,
    });
  });

  it('en cada tick corre el reaper de envíos trabados', async () => {
    m(prisma.campaign.findMany).mockResolvedValue([]);
    await dispatchDueCampaigns(NOW);
    expect(failStalled).toHaveBeenCalledWith(NOW);
  });

  it('si el reaper falla igual despacha las campañas vencidas', async () => {
    failStalled.mockRejectedValue(new Error('db'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    m(prisma.campaign.findMany).mockResolvedValue([{ id: 'c1', businessId: 'b1', scheduledAt: at(60_000) }]);
    sendCampaign.mockResolvedValue({});

    const r = await dispatchDueCampaigns(NOW);

    expect(r.sent).toBe(1);
    err.mockRestore();
  });

  it('no emite campaign:failed si otra instancia ya la tomó (count 0)', async () => {
    m(prisma.campaign.findMany).mockResolvedValue([{ id: 'c1', businessId: 'b1', scheduledAt: at(MAX_LATE_MS + 1000) }]);
    m(prisma.campaign.updateMany).mockResolvedValue({ count: 0 });
    await dispatchDueCampaigns(NOW);
    expect(emitFailed).not.toHaveBeenCalled();
  });

  it('si otra instancia ganó el claim (400) lo cuenta como skipped, sin error', async () => {
    m(prisma.campaign.findMany).mockResolvedValue([
      { id: 'c1', businessId: 'b1', scheduledAt: at(1000) },
      { id: 'c2', businessId: 'b1', scheduledAt: at(1000) },
    ]);
    sendCampaign.mockRejectedValueOnce(new AppError(400, 'Campaign already sent')).mockResolvedValueOnce({});
    const r = await dispatchDueCampaigns(NOW);
    expect(r).toMatchObject({ sent: 1, skipped: 1 });
  });

  it('sin el lock del minuto no hace nada', async () => {
    tryLock.mockResolvedValue(false);
    const r = await dispatchDueCampaigns(NOW);
    expect(r.due).toBe(0);
    expect(prisma.campaign.findMany).not.toHaveBeenCalled();
  });
});
