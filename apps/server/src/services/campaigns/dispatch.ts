/**
 * Despacho de campañas programadas.
 *
 * Cada minuto (cron en `services/scheduler.ts`) busca campañas `scheduled` con
 * `scheduledAt` vencido y las envía con `sendCampaign` (que encola el trabajo en
 * `campaign-send`: con Redis lo ejecuta un worker; sin Redis corre inline).
 *
 * Idempotencia / multi-instancia:
 *  - Lock por minuto en `sharedState` (una sola instancia despacha por tick).
 *  - Aunque dos instancias coincidan, el claim de `sendCampaign` es atómico
 *    (UPDATE ... WHERE status='scheduled'): solo una gana y la otra recibe un
 *    AppError que acá se ignora. Ese claim, no el lock ni el jobId de BullMQ
 *    (que solo dedupe 1 h), es lo que garantiza un único envío.
 *  - Una campaña muy atrasada (servidor caído) NO se envía tarde: pasa a
 *    'failed' para que el dueño decida reenviarla (un "10 % hoy" enviado dos
 *    días después puede ser peor que no enviarlo).
 */
import { prisma } from '../../lib/prisma';
import { sharedTryLock } from '../../lib/sharedState';
import { AppError } from '../../middleware/errorHandler';
import { sendCampaign } from './send';
import { emitCampaignFailed } from './events';

/** Más de esto de atraso → no se envía sola. */
export const MAX_LATE_MS = 6 * 60 * 60 * 1000;
/** Tope de campañas por tick (el resto sale en el siguiente minuto). */
const BATCH = 50;

export interface DispatchResult {
  due: number;
  sent: number;
  expired: number;
  skipped: number;
}

export async function dispatchDueCampaigns(now: Date = new Date()): Promise<DispatchResult> {
  const minute = Math.floor(now.getTime() / 60_000);
  if (!(await sharedTryLock(`campaign-dispatch:${minute}`, 90_000))) {
    return { due: 0, sent: 0, expired: 0, skipped: 0 };
  }

  const due = await prisma.campaign.findMany({
    where: { status: 'scheduled', scheduledAt: { lte: now } },
    select: { id: true, businessId: true, scheduledAt: true },
    orderBy: { scheduledAt: 'asc' },
    take: BATCH,
  });

  const result: DispatchResult = { due: due.length, sent: 0, expired: 0, skipped: 0 };
  for (const c of due) {
    const lateMs = now.getTime() - (c.scheduledAt?.getTime() ?? now.getTime());
    try {
      if (lateMs > MAX_LATE_MS) {
        const upd = await prisma.campaign.updateMany({
          where: { id: c.id, businessId: c.businessId, status: 'scheduled' },
          data: { status: 'failed' },
        });
        if (upd.count > 0) {
          result.expired++;
          await emitCampaignFailed(c.businessId, c.id, 'expired');
        }
        continue;
      }
      await sendCampaign(c.businessId, c.id, undefined, { scheduledOnly: true });
      result.sent++;
    } catch (err) {
      // 400/404: otra instancia ganó el claim, o se canceló/editó entre el listado
      // y el envío. No es un error.
      if (err instanceof AppError && (err.statusCode === 400 || err.statusCode === 404)) {
        result.skipped++;
      } else {
        console.error(`[campaigns] no se pudo despachar ${c.id}:`, (err as Error).message);
      }
    }
  }
  return result;
}
