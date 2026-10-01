/**
 * Cliente Redis compartido (opcional).
 *
 * Redis habilita dos capacidades de ESCALADO horizontal, ambas opt-in vía la
 * variable de entorno REDIS_URL:
 *   1. Rate limiting distribuido (middleware/rateLimit.ts): el conteo se comparte
 *      entre instancias, en vez de vivir en la memoria de cada proceso.
 *   2. Adaptador de Socket.IO (index.ts): los eventos en tiempo real llegan a los
 *      clientes conectados a cualquier instancia, no solo a la que emitió.
 *
 * Si REDIS_URL no está seteada, `getRedis()` devuelve null y el sistema sigue
 * funcionando con los fallbacks en memoria (válido para una sola instancia).
 */
import Redis from 'ioredis';

// undefined = no inicializado todavía; null = REDIS_URL ausente (modo single-node).
let client: Redis | null | undefined;

/** ¿Hay Redis configurado? (no abre conexión). */
export function isRedisEnabled(): boolean {
  return Boolean(process.env.REDIS_URL);
}

/**
 * Devuelve el cliente Redis compartido, o null si no hay REDIS_URL.
 * La conexión se crea una sola vez (singleton por proceso). Un error de Redis
 * se loguea pero no tumba el proceso: los callers degradan con su fallback.
 */
export function getRedis(): Redis | null {
  if (client !== undefined) return client;

  const url = process.env.REDIS_URL;
  if (!url) {
    client = null;
    return null;
  }

  // Valida el formato para fallar claro al arrancar en vez de degradar en
  // silencio con una URL mal formada. Si es inválida, deshabilita Redis
  // (fallback in-memory) en vez de tumbar el proceso.
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
      throw new Error(`esquema no soportado: ${parsed.protocol}`);
    }
  } catch (err) {
    console.error(`[redis] REDIS_URL inválida (${(err as Error).message}); se usa el fallback in-memory.`);
    client = null;
    return null;
  }

  client = new Redis(url, {
    maxRetriesPerRequest: 3,
    // Acota la latencia por comando durante una caída: en operación normal los
    // comandos tardan <5ms, así que esto solo dispara en un corte real y deja
    // que el caller degrade rápido (fail-open) en vez de colgar el request.
    commandTimeout: 1000,
    // Reconexión indefinida con backoff acotado: NUNCA devolvemos null, porque
    // eso dejaría al cliente en estado "end" sin recuperarse (rate limiter en
    // fail-open permanente y adaptador de Socket.IO muerto) tras un corte largo.
    retryStrategy: (times) => Math.min(times * 200, 5000),
  });
  client.on('error', (err) => console.error('[redis] error de conexión:', err.message));
  client.on('connect', () => console.log('[redis] conectado'));
  return client;
}

/** Cierra la conexión (para apagado limpio o tests). */
export async function closeRedis(): Promise<void> {
  if (client) await client.quit().catch(() => {});
  client = undefined;
}
