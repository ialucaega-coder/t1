/**
 * Invitaciones al equipo (token de un solo uso), sin cambios de schema.
 *
 * Flujo: un ADMIN invita un email → se crea el `TeamMember` en estado PENDING y
 * se emite un token aleatorio que viaja SOLO en el mail. Quien lo recibe lo canjea
 * en `POST /api/auth/accept-invite` (nombre + contraseña): se crea el `User` con el
 * rol del miembro, el miembro pasa a ACTIVE y el token se quema.
 *
 * Persistencia (schema congelado): una fila `Connection` por negocio con
 * type='TEAM_INVITES' y config
 * `{ invites: { [memberId]: { tokenHash, email, expiresAt, createdAt } } }`.
 *  - Nunca se guarda el token en claro: solo su SHA-256. El token tiene 256 bits de
 *    entropía, así que un hash rápido alcanza (no hay diccionario que atacar).
 *  - Un solo token vigente por miembro: reenviar la invitación REEMPLAZA la entrada
 *    y por lo tanto invalida el link anterior.
 *  - El token es `<businessId>.<secreto>`: el prefijo es solo una pista de ruteo
 *    (el canje es público y no conoce el negocio) y no es secreto. La autenticidad
 *    la da el hash del token completo, que debe estar en la fila de ESE negocio.
 *  - El rol NO viaja en el token ni en la invitación: al canjear se lee el rol
 *    actual del miembro, así que un cambio de rol entre la invitación y el canje
 *    se respeta y nadie puede "fijar" un rol viejo.
 *
 * Concurrencia: todo es lectura-modificación-escritura dentro de una transacción
 * serializada por el advisory lock del singleton + FOR UPDATE (igual que
 * twoFactorRecovery.ts), así dos canjes simultáneos del mismo token no pueden
 * crear dos usuarios.
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { lockSingleton } from '../../lib/singletonLock';

const INVITES_TYPE = 'TEAM_INVITES';
const INVITES_NAME = 'Invitaciones del equipo';
// Mismo type que usa services/auth/twoFactorRecovery.ts (ver clearRecoveryCodesTx).
const RECOVERY_TYPE = 'TWO_FACTOR_RECOVERY';

/**
 * Lock de equipo por negocio: serializa invitar / cambiar rol / quitar / CANJEAR.
 *
 * ORDEN DE LOCKS (igual en todos los caminos, para que no haya deadlock):
 *   1) TEAM_GUARD_LOCK  2) invitaciones (TEAM_INVITES)  3) códigos 2FA (TWO_FACTOR_RECOVERY)
 * y recién después las filas (TeamMember / User).
 */
export const TEAM_GUARD_LOCK = 'TEAM_MEMBERS_GUARD';

/**
 * Borra los códigos de recuperación 2FA del usuario DENTRO de la transacción dada.
 * `clearRecoveryCodes` (twoFactorRecovery.ts) abre su propia transacción y no puede
 * unirse a la del canje; copiamos su formato (`{ codes: { [userId]: string[] } }`)
 * para que reactivar la cuenta y borrar sus códigos sea una sola operación atómica.
 */
async function clearRecoveryCodesTx(tx: Prisma.TransactionClient, businessId: string, userId: string): Promise<void> {
  await lockSingleton(tx, businessId, RECOVERY_TYPE);
  const conn = await tx.connection.findFirst({
    where: { businessId, type: RECOVERY_TYPE },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  if (!conn) return;
  await tx.$queryRaw`SELECT id FROM "connections" WHERE id = ${conn.id} FOR UPDATE`;
  const fresh = await tx.connection.findUnique({ where: { id: conn.id }, select: { config: true } });
  const cfg =
    fresh?.config && typeof fresh.config === 'object' && !Array.isArray(fresh.config)
      ? (fresh.config as Record<string, unknown>)
      : {};
  const codes =
    cfg.codes && typeof cfg.codes === 'object' && !Array.isArray(cfg.codes)
      ? { ...(cfg.codes as Record<string, unknown>) }
      : {};
  if (!(userId in codes)) return;
  delete codes[userId];
  await tx.connection.update({
    where: { id: conn.id },
    data: { config: { codes } as Prisma.InputJsonObject, isActive: true },
  });
}

/** Vigencia de una invitación. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Cuánto conservamos una entrada vencida (para mostrar "vencida" en la UI) antes de podarla. */
const EXPIRED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const SECRET_BYTES = 32;
const MAX_TOKEN_LENGTH = 200;
/** Forma del token: `<businessId>.<secreto base64url>`. */
const TOKEN_PATTERN = /^([A-Za-z0-9_-]{1,64})\.([A-Za-z0-9_-]{40,128})$/;

export interface InviteRecord {
  /** SHA-256 hex del token completo. */
  tokenHash: string;
  /** Email invitado, normalizado (minúsculas). */
  email: string;
  /** ISO. */
  expiresAt: string;
  /** ISO. */
  createdAt: string;
}
type InvitesMap = Record<string, InviteRecord>;

export type InviteFailure = 'INVALID' | 'EXPIRED' | 'CONFLICT';

/**
 * Error de canje. El motivo es solo para logs/tests: hacia afuera la ruta responde
 * SIEMPRE el mismo mensaje genérico (no revelar si el email existe, si el token
 * existió o si venció).
 */
export class InviteError extends Error {
  constructor(public readonly reason: InviteFailure) {
    super(`invite:${reason}`);
    this.name = 'InviteError';
  }
}

// ─── Token ──────────────────────────────────────────────────────────

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Genera un token nuevo para el negocio. El token en claro SOLO se usa para el mail. */
export function generateInviteToken(businessId: string): { token: string; tokenHash: string } {
  const token = `${businessId}.${randomBytes(SECRET_BYTES).toString('base64url')}`;
  return { token, tokenHash: hashInviteToken(token) };
}

/** Extrae la pista de negocio de un token con forma válida; null si no la tiene. */
export function parseInviteToken(token: unknown): { businessId: string } | null {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) return null;
  const m = TOKEN_PATTERN.exec(token);
  return m ? { businessId: m[1] } : null;
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb);
}

/**
 * Busca la entrada cuyo hash coincide. Recorre TODAS las entradas (sin cortar en
 * la primera) y compara en tiempo constante, para no filtrar por timing cuántas
 * invitaciones hay ni en qué posición está la buena.
 */
function findByHash(map: InvitesMap, tokenHash: string): { memberId: string; record: InviteRecord } | null {
  let found: { memberId: string; record: InviteRecord } | null = null;
  for (const [memberId, record] of Object.entries(map)) {
    if (safeEqualHex(record.tokenHash, tokenHash) && !found) found = { memberId, record };
  }
  return found;
}

// ─── URL del front ──────────────────────────────────────────────────

/**
 * Base pública del front para armar el link. Sale de FRONTEND_URL (no hay dominio
 * hardcodeado). En producción, sin FRONTEND_URL devolvemos null: preferimos no
 * mandar un mail con un link roto a mandar uno apuntando a localhost.
 */
export function getInviteBaseUrl(): string | null {
  const configured = (process.env.FRONTEND_URL ?? '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  return process.env.NODE_ENV === 'production' ? null : 'http://localhost:3000';
}

/**
 * Link de aceptación. El token va en el FRAGMENTO (#token=...), que el navegador
 * no envía al servidor ni en el Referer: no queda en logs de acceso ni en proxies.
 */
export function buildAcceptUrl(token: string): string | null {
  const base = getInviteBaseUrl();
  return base ? `${base}/aceptar-invitacion#token=${token}` : null;
}

// ─── Persistencia ───────────────────────────────────────────────────

function readMap(config: unknown): InvitesMap {
  const cfg =
    config && typeof config === 'object' && !Array.isArray(config)
      ? (config as Record<string, unknown>)
      : {};
  const raw =
    cfg.invites && typeof cfg.invites === 'object' && !Array.isArray(cfg.invites)
      ? (cfg.invites as Record<string, unknown>)
      : {};
  const out: InvitesMap = {};
  for (const [memberId, rec] of Object.entries(raw)) {
    if (!rec || typeof rec !== 'object') continue;
    const r = rec as Record<string, unknown>;
    if (
      typeof r.tokenHash === 'string' &&
      typeof r.email === 'string' &&
      typeof r.expiresAt === 'string' &&
      typeof r.createdAt === 'string'
    ) {
      out[memberId] = { tokenHash: r.tokenHash, email: r.email, expiresAt: r.expiresAt, createdAt: r.createdAt };
    }
  }
  return out;
}

type Tx = Prisma.TransactionClient;

/**
 * Abre (y bloquea) la fila de invitaciones del negocio dentro de una transacción
 * y devuelve el mapa actual junto con un `save` para persistir los cambios.
 */
async function openInvites(
  tx: Tx,
  businessId: string,
  { create }: { create: boolean },
): Promise<{ map: InvitesMap; save: () => Promise<void> } | null> {
  await lockSingleton(tx, businessId, INVITES_TYPE);
  const existing = await tx.connection.findFirst({
    where: { businessId, type: INVITES_TYPE },
    select: { id: true },
    orderBy: { id: 'asc' },
  });

  let id = existing?.id;
  if (!id) {
    if (!create) return null;
    const created = await tx.connection.create({
      data: {
        name: INVITES_NAME,
        type: INVITES_TYPE,
        icon: 'MailPlus',
        isActive: true,
        config: { invites: {} } as Prisma.InputJsonObject,
        businessId,
      },
      select: { id: true },
    });
    id = created.id;
  } else {
    await tx.$queryRaw`SELECT id FROM "connections" WHERE id = ${id} FOR UPDATE`;
  }

  const fresh = await tx.connection.findUnique({ where: { id }, select: { config: true } });
  const map = readMap(fresh?.config);
  const connectionId = id;
  return {
    map,
    save: async () => {
      await tx.connection.update({
        where: { id: connectionId },
        data: { config: { invites: map } as unknown as Prisma.InputJsonObject, isActive: true },
      });
    },
  };
}

function prune(map: InvitesMap, now: number): void {
  for (const [memberId, rec] of Object.entries(map)) {
    if (Date.parse(rec.expiresAt) + EXPIRED_RETENTION_MS < now) delete map[memberId];
  }
}

export interface IssuedInvite {
  /** Token EN CLARO: existe solo acá, para armar el mail. Nunca se guarda ni se loguea. */
  token: string;
  expiresAt: Date;
}

/**
 * Emite (o reemplaza) la invitación de un miembro. Si ya había una, queda
 * invalidada. Debe llamarse dentro de la transacción de quien invita.
 */
export async function issueInviteTx(
  tx: Tx,
  businessId: string,
  memberId: string,
  email: string,
  now: number = Date.now(),
): Promise<IssuedInvite> {
  const opened = (await openInvites(tx, businessId, { create: true }))!;
  const { token, tokenHash } = generateInviteToken(businessId);
  const expiresAt = new Date(now + INVITE_TTL_MS);
  prune(opened.map, now);
  opened.map[memberId] = {
    tokenHash,
    email: email.trim().toLowerCase(),
    expiresAt: expiresAt.toISOString(),
    createdAt: new Date(now).toISOString(),
  };
  await opened.save();
  return { token, expiresAt };
}

/** Revoca la invitación pendiente de un miembro (si hay). Dentro de una transacción. */
export async function revokeInviteTx(tx: Tx, businessId: string, memberId: string): Promise<boolean> {
  const opened = await openInvites(tx, businessId, { create: false });
  if (!opened || !(memberId in opened.map)) return false;
  delete opened.map[memberId];
  await opened.save();
  return true;
}

/** Vencimiento de las invitaciones del negocio, por miembro. Nunca expone hashes. */
export async function listInviteExpiries(businessId: string): Promise<Record<string, string>> {
  const conn = await prisma.connection.findFirst({
    where: { businessId, type: INVITES_TYPE },
    select: { config: true },
    orderBy: { id: 'asc' },
  });
  const out: Record<string, string> = {};
  for (const [memberId, rec] of Object.entries(readMap(conn?.config))) out[memberId] = rec.expiresAt;
  return out;
}

// ─── Canje ──────────────────────────────────────────────────────────

/**
 * Chequeo de solo lectura (sin lock) de que el token existe y no venció. Sirve para
 * descartar tokens basura ANTES de gastar un hash Argon2 (CPU) en un request
 * anónimo. El canje real revalida todo bajo lock.
 */
export async function isInviteTokenLive(token: unknown, now: number = Date.now()): Promise<boolean> {
  const parsed = parseInviteToken(token);
  if (!parsed) return false;
  const conn = await prisma.connection.findFirst({
    where: { businessId: parsed.businessId, type: INVITES_TYPE },
    select: { config: true },
    orderBy: { id: 'asc' },
  });
  const hit = findByHash(readMap(conn?.config), hashInviteToken(token as string));
  return !!hit && Date.parse(hit.record.expiresAt) > now;
}

/** Rol del miembro → rol de login. VIEWER no tiene equivalente staff: queda como CLIENT. */
export function teamRoleToUserRole(role: string): 'ADMIN' | 'PROFESSIONAL' | 'CLIENT' {
  if (role === 'ADMIN') return 'ADMIN';
  if (role === 'PROFESSIONAL') return 'PROFESSIONAL';
  return 'CLIENT';
}

export interface AcceptedInvite {
  user: { id: string; email: string; name: string; role: string };
  business: { id: string; name: string; slug: string };
  memberId: string;
}

/**
 * Canjea el token: crea el usuario con el rol actual del miembro, activa al miembro
 * y quema el token, todo en una transacción. Lanza InviteError ante cualquier
 * problema (el motivo no debe llegar al cliente).
 *
 * `passwordHash` ya viene hasheado (Argon2id) por la ruta, con las mismas reglas de
 * contraseña que el registro.
 */
export async function acceptInvite(params: {
  token: string;
  name: string;
  passwordHash: string;
  now?: number;
}): Promise<AcceptedInvite> {
  const { token, name, passwordHash } = params;
  const now = params.now ?? Date.now();
  const parsed = parseInviteToken(token);
  if (!parsed) throw new InviteError('INVALID');
  const { businessId } = parsed;
  const tokenHash = hashInviteToken(token);

  try {
    return await prisma.$transaction(async (tx) => {
      // Mismo lock que invitar / cambiar rol / quitar (y ANTES del de invitaciones):
      // así el canje no corre en paralelo con un DELETE o un PATCH del miembro y lee su
      // rol y su estado ya consistentes (sin usuarios activos sin fila de equipo).
      await lockSingleton(tx, businessId, TEAM_GUARD_LOCK);
      const opened = await openInvites(tx, businessId, { create: false });
      if (!opened) throw new InviteError('INVALID');

      const hit = findByHash(opened.map, tokenHash);
      // Reuso: el token ya se quemó (o se reemplazó por un reenvío) → no está.
      if (!hit) throw new InviteError('INVALID');
      if (Date.parse(hit.record.expiresAt) <= now) throw new InviteError('EXPIRED');

      const { memberId, record } = hit;
      const member = await tx.teamMember.findFirst({ where: { id: memberId, businessId } });
      if (!member || member.status !== 'PENDING' || member.email.toLowerCase() !== record.email) {
        throw new InviteError('INVALID');
      }

      // El email es único global en User. Si ya existe, solo se reactiva una cuenta
      // dada de baja de ESTE negocio; cualquier otra cosa (cuenta activa, de otro
      // negocio, con borrado lógico) es un conflicto y no se toca.
      const existing = await tx.user.findUnique({ where: { email: record.email } });
      const role = teamRoleToUserRole(member.role);
      let user: { id: string; email: string; name: string; role: string };
      if (existing) {
        const reactivable = existing.businessId === businessId && !existing.isActive && !existing.deletedAt;
        if (!reactivable) throw new InviteError('CONFLICT');
        // El link por mail actúa como un reset de contraseña con sesión plena. Para que no
        // sirva de atajo al segundo factor, la cuenta reactivada vuelve SIN 2FA y sin sus
        // códigos de recuperación viejos (si lo quiere, lo activa de nuevo).
        user = await tx.user.update({
          where: { id: existing.id },
          data: {
            name,
            passwordHash,
            role,
            isActive: true,
            failedLogins: 0,
            lockedUntil: null,
            twoFactorEnabled: false,
            twoFactorSecret: null,
          },
          select: { id: true, email: true, name: true, role: true },
        });
        await clearRecoveryCodesTx(tx, businessId, existing.id);
      } else {
        user = await tx.user.create({
          data: { email: record.email, passwordHash, name, role, businessId },
          select: { id: true, email: true, name: true, role: true },
        });
      }

      const activated = await tx.teamMember.updateMany({
        where: { id: memberId, businessId, status: 'PENDING' },
        data: { status: 'ACTIVE', name },
      });
      if (activated.count !== 1) throw new InviteError('INVALID');

      delete opened.map[memberId];
      await opened.save();

      const business = await tx.business.findUnique({
        where: { id: businessId },
        select: { id: true, name: true, slug: true },
      });
      if (!business) throw new InviteError('INVALID');

      return { user, business, memberId };
    });
  } catch (err) {
    if (err instanceof InviteError) throw err;
    // Carrera con un registro/otra invitación del mismo email: unique de User.email.
    if ((err as { code?: string })?.code === 'P2002') throw new InviteError('CONFLICT');
    throw err;
  }
}
