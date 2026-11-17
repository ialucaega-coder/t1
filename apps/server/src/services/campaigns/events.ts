/**
 * Eventos en tiempo real de campañas (sala `business:<id>`).
 *  - `campaign:sent`   → { campaign, envio: { enviados, fallidos } }  (lo emite send.ts)
 *  - `campaign:failed` → { campaign, envio?, reason }  (sin reintentos, vencida, trabada o con error al despachar)
 */
import { prisma } from '../../lib/prisma';
import { getIO } from '../../lib/socket';

export type CampaignFailReason = 'retries_exhausted' | 'expired' | 'stalled' | 'error';

/** Avisa al panel que la campaña pasó a 'failed'. Nunca lanza (es solo notificación). */
export async function emitCampaignFailed(
  businessId: string,
  id: string,
  reason: CampaignFailReason,
  envio?: { enviados: number; fallidos: number },
): Promise<void> {
  try {
    const campaign = await prisma.campaign.findFirst({ where: { id, businessId } });
    if (!campaign) return;
    getIO()?.to(`business:${businessId}`).emit('campaign:failed', { campaign, envio, reason });
  } catch {
    /* notificación best-effort */
  }
}
