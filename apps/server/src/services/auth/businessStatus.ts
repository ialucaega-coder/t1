/**
 * Estado de suspensión del negocio para el auth.
 *
 * Suspender un negocio (panel de plataforma) solo ponía `isActive=false`: ni el
 * login ni `requireAuth` lo miraban, así que sus usuarios seguían operando. Acá se
 * consulta ese flag con una caché corta (30 s) porque `requireAuth` corre en cada
 * request. Al suspender/reactivar se invalida la caché de la instancia que ejecuta
 * el cambio (las demás convergen en ≤ 30 s).
 *
 * Política ante error: FAIL OPEN (igual que la revocación de sesiones): una caída
 * puntual de la DB no debe bloquear a todos los negocios. Solo `isActive === false`
 * cuenta como suspendido (un dato ausente o raro no bloquea).
 */
import { prisma } from '../../lib/prisma';
import { cache, cacheKey } from '../../lib/cache';

const TTL_MS = 30_000;

const keyFor = (businessId: string) => cacheKey(businessId, 'business-active');

/** ¿El negocio está habilitado (no suspendido)? Nunca lanza. */
export async function isBusinessActive(businessId: string): Promise<boolean> {
  const key = keyFor(businessId);
  const cached = cache.get<boolean>(key);
  if (cached !== undefined) return cached;
  try {
    const row = await prisma.business.findUnique({ where: { id: businessId }, select: { isActive: true } });
    const active = row?.isActive !== false;
    cache.set(key, active, TTL_MS);
    return active;
  } catch {
    return true; // fail open (sin cachear: el próximo request reintenta)
  }
}

/** Fuerza a releer el estado del negocio en esta instancia (tras suspender/reactivar). */
export function invalidateBusinessActive(businessId: string): void {
  cache.del(keyFor(businessId));
}
