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

  client = new Redis(url, {
    maxRetriesPerRequest: 3,
    // No reintenta para siempre si el host no existe: evita ruido infinito.
    retryStrategy: (times) => (times > 10 ? null : Math.min(times * 200, 2000)),
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
