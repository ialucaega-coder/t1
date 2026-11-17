/**
 * Caché en memoria con TTL, pensada para datos de solo lectura y de vida corta
 * (por ejemplo, las estadísticas del dashboard).
 *
 * Diseño:
 * - Sin dependencias externas: usa un `Map` en memoria del proceso.
 * - Multi-tenant: las claves deben incluir el `businessId` para que un negocio
 *   nunca vea datos cacheados de otro. Usá el helper `cacheKey(businessId, ...)`.
 * - Expiración perezosa: cada entrada guarda su vencimiento y se descarta al
 *   leerla si ya expiró. Además hay un barrido periódico opcional para liberar
 *   memoria de claves que nunca se vuelven a consultar.
 *
 * Nota: al ser una caché de proceso, no se comparte entre instancias. Para el
 * caso de uso actual (TTL corto sobre stats) es suficiente y evita sumar Redis.
 */

interface CacheEntry<T> {
  value: T;
  /** Timestamp (ms) en el que la entrada deja de ser válida. */
  expiresAt: number;
}

class MemoryCache {
  private store = new Map<string, CacheEntry<unknown>>();

  /** Devuelve el valor cacheado si existe y no expiró; si no, `undefined`. */
  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  /** Guarda un valor con un TTL en milisegundos. */
  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  /** Elimina una clave puntual. */
  del(key: string): void {
    this.store.delete(key);
  }

  /** Invalida todas las claves que empiezan con el prefijo dado. */
  invalidate(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  /** Vacía por completo la caché (útil en tests). */
  clear(): void {
    this.store.clear();
  }

  /** Elimina las entradas vencidas para liberar memoria. */
  prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }
}

/** Instancia singleton de la caché en memoria compartida por la app. */
export const cache = new MemoryCache();

// Barrido periódico para no acumular entradas vencidas indefinidamente.
// `unref()` evita que este timer mantenga vivo el proceso al apagarse.
const pruneTimer = setInterval(() => cache.prune(), 60_000);
if (typeof pruneTimer.unref === 'function') {
  pruneTimer.unref();
}

/**
 * Construye una clave de caché multi-tenant. Siempre antepone el `businessId`
 * para aislar los datos entre negocios.
 *
 * Ejemplo: `cacheKey('biz_1', 'stats', 'overview') => 'biz_1:stats:overview'`
 */
export function cacheKey(
  businessId: string,
  ...parts: (string | number)[]
): string {
  return [businessId, ...parts].join(':');
}
