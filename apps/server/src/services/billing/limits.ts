/**
 * Límites del plan por negocio (enforcement de recursos).
 *
 * Igual que `maxMessages` (ver billing/quota.ts), `maxBots` estaba definido en el
 * plan pero no se aplicaba: un negocio podía crear bots ilimitados. Acá calculamos
 * la capacidad de bots del plan para frenar la creación cuando se llega al tope.
 */
import { prisma } from '../../lib/prisma';

/** Cupo de bots por defecto cuando el negocio no tiene suscripción. */
export const FREE_MAX_BOTS = 1;

export interface BotCapacity {
  used: number;
  limit: number;
  atLimit: boolean;
}

/**
 * Capacidad de bots del negocio: cuántos tiene vs. el `maxBots` de su plan.
 * No se cachea: la creación de bots es poco frecuente y el conteo debe ser fresco.
 */
export async function getBotCapacity(businessId: string): Promise<BotCapacity> {
  const [sub, used] = await Promise.all([
    prisma.subscription.findUnique({
      where: { businessId },
      include: { plan: { select: { maxBots: true } } },
    }),
    prisma.bot.count({ where: { businessId } }),
  ]);
  const limit = sub?.plan.maxBots ?? FREE_MAX_BOTS;
  return { used, limit, atLimit: used >= limit };
}

/** Cupo de contactos (clientes) por defecto sin suscripción. */
export const FREE_MAX_CONTACTS = 100;

export interface ContactCapacity {
  used: number;
  limit: number;
  atLimit: boolean;
}

/**
 * Capacidad de contactos (clientes) del negocio vs. el `maxContacts` de su plan.
 * Cuenta solo clientes activos (no borrados), que es lo que consume el cupo.
 */
export async function getContactCapacity(businessId: string): Promise<ContactCapacity> {
  const [sub, used] = await Promise.all([
    prisma.subscription.findUnique({
      where: { businessId },
      include: { plan: { select: { maxContacts: true } } },
    }),
    prisma.user.count({ where: { businessId, role: 'CLIENT', deletedAt: null } }),
  ]);
  const limit = sub?.plan.maxContacts ?? FREE_MAX_CONTACTS;
  return { used, limit, atLimit: used >= limit };
}
