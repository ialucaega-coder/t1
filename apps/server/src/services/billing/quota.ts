/**
 * Cupo mensual de mensajes del bot por negocio (enforcement del plan).
 *
 * `plan.maxMessages` definía el tope por período pero no se aplicaba en ningún
 * lado: cualquier negocio podía mandar mensajes ilimitados sin importar su plan.
 * Acá lo enforzamos contando los mensajes del bot dentro del período de la
 * suscripción (o del mes calendario si no hay suscripción).
 *
 * El conteo sale de la DB (autoritativo y compartido entre instancias) y se
 * cachea unos segundos para no pegarle a la base en cada mensaje. Es un cupo
 * "blando": por el TTL de caché puede permitir unos pocos mensajes de más al
 * cruzar el límite, lo cual es aceptable para una guarda de costo/plan.
 */
import { prisma } from '../../lib/prisma';
import { cache, cacheKey } from '../../lib/cache';

const QUOTA_TTL_MS = 30_000;
/** Cupo por defecto cuando el negocio no tiene suscripción (tier gratuito). */
export const FREE_MONTHLY_MESSAGES = 500;

export interface MessageQuota {
  used: number;
  limit: number;
  remaining: number;
  overQuota: boolean;
  periodStart: string;
  periodEnd: string | null;
  plan: string | null;
}

/**
 * Devuelve el uso de mensajes del bot del negocio en el período vigente y si se
 * superó el cupo del plan. Cacheado unos segundos (ver nota de cupo "blando").
 */
export async function getMessageQuota(businessId: string): Promise<MessageQuota> {
  const key = cacheKey(businessId, 'msg-quota');
  const cached = cache.get<MessageQuota>(key);
  if (cached) return cached;

  const sub = await prisma.subscription.findUnique({
    where: { businessId },
    include: { plan: { select: { name: true, maxMessages: true } } },
  });

  const now = new Date();
  const calendarMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  // Usamos el período de la suscripción SOLO si sigue vigente. Si venció (webhook
  // de renovación caído, suscripción cancelada/past-due, trial vencido), caer al
  // período de la suscripción dejaría el conteo acumulando desde un inicio viejo
  // y al negocio en overQuota para siempre. En ese caso usamos el mes calendario.
  let periodStart: Date;
  let periodEnd: Date | null;
  if (sub && sub.currentPeriodEnd > now) {
    periodStart = sub.currentPeriodStart;
    periodEnd = sub.currentPeriodEnd;
  } else {
    periodStart = calendarMonthStart;
    periodEnd = null;
  }
  const limit = sub?.plan.maxMessages ?? FREE_MONTHLY_MESSAGES;
  const planName = sub?.plan.name ?? null;

  const used = await prisma.message.count({
    where: {
      role: 'BOT',
      createdAt: { gte: periodStart },
      conversation: { businessId },
    },
  });

  const remaining = Math.max(limit - used, 0);
  const result: MessageQuota = {
    used,
    limit,
    remaining,
    overQuota: used >= limit,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd ? periodEnd.toISOString() : null,
    plan: planName,
  };

  cache.set(key, result, QUOTA_TTL_MS);
  return result;
}
