/**
 * Eventos en tiempo real de campañas (sala `business:<id>`).
 *  - `campaign:sent`   → { campaign, envio: { enviados, fallidos } }  (lo emite send.ts)
 *  - `campaign:progress` → { campaignId, progress: { enviados, fallidos, procesados, total } }  (durante el envío)
 *  - `campaign:failed` → { campaign, envio?, reason }  (sin reintentos, vencida, trabada o con error al despachar)
 */
import { prisma } from '../../lib/prisma';
import { getIO } from '../../lib/socket';

export interface CampaignProgress {
  enviados: number;
  fallidos: number;
  procesados: number;
  total: number;
}

/**
 * Avance de un envío en curso (`campaign:progress`: { campaignId, progress }). Se emite con
 * el latido (cada 25 destinatarios o 60 s). Liviano: sin lecturas a la DB y nunca lanza.
 */
export function emitCampaignProgress(businessId: string, id: string, progress: CampaignProgress): void {
  try {
    getIO()?.to(`business:${businessId}`).emit('campaign:progress', { campaignId: id, progress });
  } catch {
    /* notificación best-effort */
  }
}

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
