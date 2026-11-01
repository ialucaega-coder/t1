/**
 * Revocación de sesiones JWT sin cambios de schema.
 *
 * Los JWT son stateless: una vez emitidos valen hasta expirar (14 días). Eso
 * significa que un logout, un cambio de contraseña o una baja NO invalidaban el
 * token viejo. Acá agregamos revocación PASIVA: por cada usuario guardamos un
 * corte temporal `validFrom` (epoch ms); todo token emitido ANTES de ese corte
 * se considera revocado. Se compara contra el claim `iat` del token.
 *
 * Persistencia (schema congelado): una fila `Connection` por negocio con
 * type='SESSION_REVOCATION' y config `{ validFrom: { [userId]: number } }`.
 * Mismo patrón que los permisos del equipo.
 *
 * Rendimiento: `requireAuth` corre en cada request, así que cacheamos el mapa
 * por negocio en memoria con TTL corto (15s) para no pegarle a la DB en cada
 * llamada. La revocación tarda a lo sumo el TTL en propagarse (y es inmediata
 * en la instancia que la ejecuta, porque refrescamos la caché ahí mismo).
 *
 * Política ante error: FAIL OPEN. Si no podemos leer el store, dejamos pasar el
 * token en vez de bloquear a todos los usuarios ante una caída puntual — la
 * revocación es una mejora de seguridad, no debe tumbar la disponibilidad.
 */
import { prisma } from '../../lib/prisma';
import { cache, cacheKey } from '../../lib/cache';
import { lockSingleton } from '../../lib/singletonLock';

const REVOCATION_TYPE = 'SESSION_REVOCATION';
const REVOCATION_NAME = 'Revocación de sesiones';
const CACHE_TTL_MS = 15_000;

type ValidFromMap = Record<string, number>;

function cacheKeyFor(businessId: string): string {
  return cacheKey(businessId, 'session-revocation');
}

function normalize(config: unknown): ValidFromMap {
  const cfg =
    config && typeof config === 'object' && !Array.isArray(config)
      ? (config as Record<string, unknown>)
      : {};
  const raw =
    cfg.validFrom && typeof cfg.validFrom === 'object' && !Array.isArray(cfg.validFrom)
      ? (cfg.validFrom as Record<string, unknown>)
      : {};
  const out: ValidFromMap = {};
  for (const [uid, ts] of Object.entries(raw)) {
    if (typeof ts === 'number' && ts > 0) out[uid] = ts;
  }
  return out;
}

/**
 * Vida máxima de un JWT (mismo `JWT_EXPIRES_IN` que usa routes/auth.ts). Acepta
 * segundos (número) o `<n><s|m|h|d|w|y>`. Ante un formato que no entendemos devuelve
 * Infinity (= no podar nunca): preferible a podar de más y revivir un token revocado.
 */
export function jwtLifetimeMs(raw: string | undefined = process.env.JWT_EXPIRES_IN): number {
  const DEFAULT = 14 * 24 * 60 * 60 * 1000;
  if (!raw) return DEFAULT;
  const m = /^(\d+)\s*([smhdwy]?)$/i.exec(raw.trim());
  if (!m) return Infinity;
  const unit = { '': 1000, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000, y: 31_536_000_000 }[
    m[2].toLowerCase() as '' | 's' | 'm' | 'h' | 'd' | 'w' | 'y'
  ];
  return Number(m[1]) * unit;
}

/**
 * Descarta cortes que ya no pueden afectar a ningún token: todo token emitido
 * antes de un corte vence a más tardar `corte + vida del JWT`, así que pasado ese
 * plazo (más un día de margen) la entrada es inerte. Es poda exacta: no cambia qué
 * tokens se consideran revocados. Sin esto el mapa crece con cada usuario que alguna
 * vez cerró sesión. `keepUserId` (el que se está revocando ahora) nunca se poda.
 */
export function pruneExpired(map: ValidFromMap, now: number, keepUserId?: string): ValidFromMap {
  const horizon = now - jwtLifetimeMs() - 24 * 60 * 60 * 1000;
  const out: ValidFromMap = {};
  for (const [uid, ts] of Object.entries(map)) {
    if (ts >= horizon || uid === keepUserId) out[uid] = ts;
  }
  return out;
}

async function loadMap(businessId: string): Promise<ValidFromMap> {
  const key = cacheKeyFor(businessId);
  const cached = cache.get<ValidFromMap>(key);
  if (cached) return cached;
  let map: ValidFromMap = {};
  try {
    const conn = await prisma.connection.findFirst({
      where: { businessId, type: REVOCATION_TYPE },
      select: { config: true },
      orderBy: { id: 'asc' },
    });
    map = normalize(conn?.config);
  } catch {
    map = {}; // fail open
  }
  cache.set(key, map, CACHE_TTL_MS);
  return map;
}

/**
 * ¿El token está revocado? Compara el `iat` (en segundos) del token contra el
 * corte del usuario. Sin `iat` no podemos comparar → fail open (no revocado).
 */
export async function isSessionRevoked(
  businessId: string,
  userId: string,
  iatSeconds?: number
): Promise<boolean> {
  if (!iatSeconds) return false;
  try {
    const map = await loadMap(businessId);
    const validFrom = map[userId];
    if (!validFrom) return false;
    return iatSeconds * 1000 < validFrom;
  } catch {
    return false; // fail open
  }
}

/**
 * Revoca las sesiones del usuario emitidas ANTES de `cutoffMs` (default: ahora).
 *
 * - Logout / baja: usar el default (ahora) → mata todas las sesiones, incluida
 *   la actual.
 * - Cambio de contraseña: pasar el `iat` (en ms) del token actual → mata todas
 *   las sesiones ANTERIORES pero deja viva la actual (no echamos al usuario que
 *   acaba de cambiar su clave).
 *
 * Transaccional con lock de fila (igual que brand/permisos) para no pisar el
 * corte de otro usuario ante guardados concurrentes.
 */
export async function revokeUserSessions(
  businessId: string,
  userId: string,
  cutoffMs: number = Date.now()
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockSingleton(tx, businessId, REVOCATION_TYPE);
    let conn = await tx.connection.findFirst({
      where: { businessId, type: REVOCATION_TYPE },
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    if (!conn) {
      conn = await tx.connection.create({
        data: {
          name: REVOCATION_NAME,
          type: REVOCATION_TYPE,
          icon: 'ShieldOff',
          isActive: true,
          config: { validFrom: {} } as unknown as object,
          businessId,
        },
        select: { id: true },
      });
    } else {
      await tx.$queryRaw`SELECT id FROM "connections" WHERE id = ${conn.id} FOR UPDATE`;
    }

    const fresh = await tx.connection.findUnique({ where: { id: conn.id }, select: { config: true } });
    const map = pruneExpired(normalize(fresh?.config), Date.now(), userId);
    map[userId] = cutoffMs;

    await tx.connection.update({
      where: { id: conn.id },
      data: { config: { validFrom: map } as unknown as object, isActive: true },
    });

    // Refresca la caché de esta instancia para que el corte aplique ya mismo.
    cache.set(cacheKeyFor(businessId), map, CACHE_TTL_MS);
  });
}
