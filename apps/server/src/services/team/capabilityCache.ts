/**
 * Caché de vida corta de lo que `requireCapability` consulta en cada request:
 * plan del negocio, overrides por miembro y mapeo usuario→miembro.
 *
 * Es por instancia: un cambio hecho en OTRA instancia tarda hasta CAP_TTL_MS en
 * verse (mismo criterio que la revocación de sesiones). En la instancia que lo
 * hace, los puntos de escritura (permisos del equipo, cambio de plan) llaman a
 * `invalidateCapabilityCache` y aplica al instante.
 */
import { cache, cacheKey } from '../../lib/cache';

export const CAP_TTL_MS = 10_000;

/** Clave multi-tenant de una entrada de capacidades (siempre bajo `<biz>:cap:`). */
export function capKey(businessId: string, ...parts: string[]): string {
  return cacheKey(businessId, 'cap', ...parts);
}

/** Descarta todo lo cacheado de capacidades del negocio. */
export function invalidateCapabilityCache(businessId: string): void {
  cache.invalidate(`${businessId}:cap:`);
}
