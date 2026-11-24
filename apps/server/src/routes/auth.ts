import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { authRateLimit } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { z } from 'zod';
import { registerSchema, loginSchema, twoFactorCodeSchema, secondFactorCodeSchema, passwordSchema, acceptInviteSchema, RegisterInput, LoginInput, AcceptInviteInput } from '../validators/auth';
import { requireAuth } from '../middleware/auth';
import { getAuthSecret, JWT_ALGORITHM } from '../lib/secrets';
import { sharedIncr } from '../lib/sharedState';
import { revokeUserSessions, isSessionRevoked } from '../services/auth/revocation';
import { isBusinessActive } from '../services/auth/businessStatus';
import { generateTwoFactorSetup, verifyTwoFactorToken } from '../services/twoFactor';
import {
  generateRecoveryCodes,
  countRecoveryCodes,
  clearRecoveryCodes,
  verifySecondFactor,
} from '../services/auth/twoFactorRecovery';
import { hashPassword, verifyPassword, equalizeVerifyTiming } from '../lib/password';
import { acceptInvite, isInviteTokenLive, InviteError } from '../services/team/invitations';
import { acceptInviteRateLimit } from '../services/team/inviteRateLimit';

const updateMeSchema = z.object({
  name: z.string().max(100).optional(),
  currentPassword: z.string().max(128).optional(),
  // Misma política de fortaleza que el registro (8+ con mayúscula, minúscula y
  // número) en vez del viejo min(6), más débil.
  newPassword: passwordSchema.optional(),
});
import { auditAuthEvent } from '../middleware/audit';
import type { Request, Response, NextFunction } from 'express';

const router = Router();

// Duración del JWT y de la cookie de sesión asociada. Configurable por env
// JWT_EXPIRES_IN (formato de `vercel/ms`, ej. '7d', '14d', '12h'); default '14d'.
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN || '14d') as jwt.SignOptions['expiresIn'];
const JWT_COOKIE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

/**
 * Emite una cookie httpOnly con el JWT, además de devolverlo en el
 * cuerpo de la respuesta. El frontend actual guarda el token en
 * localStorage y lo envía como Bearer token; la cookie es una
 * defensa en profundidad adicional que además permite que el
 * middleware de Next.js (apps/web/src/middleware.ts) valide la
 * sesión en el servidor sin depender de localStorage.
 */
function setSessionCookie(res: Response, token: string) {
  res.cookie('session_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: JWT_COOKIE_MAX_AGE_MS,
  });
}

function clearSessionCookie(res: Response) {
  res.clearCookie('session_token', { path: '/' });
}

function signToken(payload: { userId: string; businessId: string; role: string }, iatSeconds?: number) {
  return jwt.sign(iatSeconds ? { ...payload, iat: iatSeconds } : payload, getAuthSecret(), {
    algorithm: JWT_ALGORITHM,
    expiresIn: JWT_EXPIRES_IN,
  });
}

/** Mensaje genérico para un negocio suspendido por la plataforma. */
const SUSPENDED_MESSAGE = 'Cuenta suspendida. Contactá a soporte.';

/**
 * Registra UN intento fallido de login de forma atómica (`increment` en la base) y
 * decide el bloqueo con el valor devuelto: antes se leía `failedLogins`, se sumaba 1
 * en memoria y se escribía, así que N intentos paralelos contaban como 1 y el tope de
 * 5 se podía esquivar con ráfagas.
 */
async function registerFailedLogin(userId: string): Promise<{ failedLogins: number; locked: boolean }> {
  const row = await prisma.user.update({
    where: { id: userId },
    data: { failedLogins: { increment: 1 } },
    select: { failedLogins: true },
  });
  const failedLogins = row.failedLogins;
  const locked = failedLogins >= MAX_FAILED_LOGINS;
  if (locked) {
    await prisma.user.update({ where: { id: userId }, data: { lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS) } });
  }
  return { failedLogins, locked };
}

/**
 * Tope de intentos de código 2FA por usuario (además del límite por IP): sin él, una
 * sesión robada podía probar códigos TOTP desde muchas IPs.
 */
const TWO_FA_USER_WINDOW_MS = 10 * 60 * 1000;
const TWO_FA_USER_MAX = 10;
async function twoFactorUserLimit(req: Request, res: Response, next: NextFunction) {
  // Igual que tenantRateLimit: en tests no corre salvo TENANT_RL_FORCE=true (los tests
  // de las rutas hacen muchas llamadas con el mismo usuario).
  if (process.env.NODE_ENV === 'test' && process.env.TENANT_RL_FORCE !== 'true') {
    next();
    return;
  }
  try {
    const count = await sharedIncr(`2fa-attempts:${req.auth!.userId}:${Math.floor(Date.now() / TWO_FA_USER_WINDOW_MS)}`, TWO_FA_USER_WINDOW_MS);
    if (count > TWO_FA_USER_MAX) {
      res.status(429).json({ error: 'Demasiados intentos. Esperá unos minutos e intentá de nuevo.' });
      return;
    }
  } catch {
    /* sin contador compartido no se bloquea: queda el límite por IP */
  }
  next();
}

router.post(
  '/register',
  authRateLimit,
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const data = req.body as RegisterInput;
    const exists = await prisma.user.findUnique({ where: { email: data.email } });
    if (exists) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }

    const passwordHash = await hashPassword(data.password);
    const slug = data.businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    const business = await prisma.business.create({
      data: {
        name: data.businessName,
        slug: `${slug}-${Date.now().toString(36)}`,
        users: {
          create: {
            email: data.email,
            passwordHash,
            name: data.name,
            role: 'ADMIN',
          },
        },
      },
      include: { users: true },
    });

    const user = business.users[0];
    const token = signToken({ userId: user.id, businessId: business.id, role: user.role });
    setSessionCookie(res, token);

    auditAuthEvent('AUTH_REGISTER', req, { userId: user.id, businessId: business.id });

    res.status(201).json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      business: { id: business.id, name: business.name, slug: business.slug },
    });
  })
);

router.post(
  '/login',
  authRateLimit,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const data = req.body as LoginInput;
    const user = await prisma.user.findUnique({
      where: { email: data.email },
      include: { business: true },
    });

    if (!user) {
      // No revelamos si el email existe o no (evita enumeración de usuarios).
      // Corremos un verify "dummy" para que el tiempo de respuesta sea similar al
      // de un email registrado y no se pueda inferir la existencia por timing.
      await equalizeVerifyTiming();
      auditAuthEvent('AUTH_LOGIN_FAILURE', req, { metadata: { reason: 'unknown_email' } });
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    // Cuentas desactivadas o con borrado lógico no pueden iniciar sesión, ni
    // siquiera con la contraseña correcta. Respuesta genérica para no revelar
    // el estado de la cuenta.
    if (!user.isActive || user.deletedAt) {
      await equalizeVerifyTiming();
      auditAuthEvent('AUTH_LOGIN_FAILURE', req, {
        userId: user.id,
        businessId: user.businessId,
        metadata: { reason: 'inactive_account' },
      });
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      // Cuenta bloqueada: misma respuesta que unas credenciales inválidas (antes era
      // 423, que confirmaba que el email existe y que estaba bajo ataque) y el mismo
      // costo de tiempo. El motivo queda en la auditoría.
      await equalizeVerifyTiming();
      auditAuthEvent('AUTH_ACCOUNT_LOCKED', req, { userId: user.id, businessId: user.businessId });
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    // Bloqueo vencido: el contador arranca de cero (antes seguía en 5 y el primer
    // error posterior volvía a bloquear al instante).
    if (user.lockedUntil) {
      await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
      user.failedLogins = 0;
      user.lockedUntil = null;
    }

    const { valid: validPassword, needsRehash } = await verifyPassword(data.password, user.passwordHash);
    if (!validPassword) {
      const { failedLogins, locked } = await registerFailedLogin(user.id);

      auditAuthEvent('AUTH_LOGIN_FAILURE', req, {
        userId: user.id,
        businessId: user.businessId,
        metadata: { failedLogins, locked },
      });

      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    // Negocio suspendido por la plataforma: ni con la contraseña correcta se entra.
    // (Después de validar la contraseña, para no revelar el estado a quien no la tiene.)
    if (user.business.isActive === false) {
      auditAuthEvent('AUTH_LOGIN_FAILURE', req, {
        userId: user.id,
        businessId: user.businessId,
        metadata: { reason: 'business_suspended' },
      });
      res.status(403).json({ error: SUSPENDED_MESSAGE });
      return;
    }

    // Segundo factor (TOTP): si la cuenta lo tiene activo, la contraseña sola
    // no alcanza. Sin código → pedirlo (200, sin token). Con código inválido →
    // 401. La contraseña ya se validó, así que no revela existencia de la cuenta.
    if (user.twoFactorEnabled && user.twoFactorSecret) {
      if (!data.twoFactorCode) {
        res.json({ twoFactorRequired: true });
        return;
      }
      const secondFactor = await verifySecondFactor({
        businessId: user.businessId,
        userId: user.id,
        encryptedSecret: user.twoFactorSecret,
        code: data.twoFactorCode,
      });
      if (!secondFactor) {
        // Un código 2FA incorrecto cuenta para el bloqueo igual que una contraseña
        // incorrecta; si no, quien ya conoce la clave podría probar los 10^6
        // códigos posibles sin consecuencias.
        const { failedLogins, locked } = await registerFailedLogin(user.id);
        auditAuthEvent('AUTH_LOGIN_FAILURE', req, {
          userId: user.id,
          businessId: user.businessId,
          metadata: { reason: 'invalid_2fa_code', failedLogins, locked },
        });
        res.status(401).json({ error: 'Invalid 2FA code' });
        return;
      }
      if (secondFactor === 'recovery') {
        auditAuthEvent('AUTH_2FA_RECOVERY_USED', req, { userId: user.id, businessId: user.businessId });
      }
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    // Rehash perezoso best-effort: si entró con un hash bcrypt legado, lo
    // reescribimos a Argon2id. Va en su propia escritura y en try/catch para que
    // un fallo de Argon2 NO rompa un login válido. El updateMany condicionado al
    // hash viejo evita pisar una contraseña que el usuario haya cambiado en
    // paralelo (entre el findUnique y este punto).
    if (needsRehash) {
      try {
        const rehashed = await hashPassword(data.password);
        await prisma.user.updateMany({
          where: { id: user.id, passwordHash: user.passwordHash },
          data: { passwordHash: rehashed },
        });
      } catch {
        /* best-effort: el próximo login reintenta la migración */
      }
    }

    const token = signToken({ userId: user.id, businessId: user.businessId, role: user.role });
    setSessionCookie(res, token);

    auditAuthEvent('AUTH_LOGIN_SUCCESS', req, { userId: user.id, businessId: user.businessId });

    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      business: { id: user.business.id, name: user.business.name, slug: user.business.slug },
    });
  })
);

// Mensaje único para TODO fallo del canje (token inexistente, usado, vencido, email
// ya registrado en otro lado...): no revela si el email existe ni por qué falló.
const INVITE_GENERIC_ERROR =
  'La invitación no es válida o ya venció. Pedile a quien te invitó que te envíe una nueva.';

/**
 * Canje de una invitación al equipo (público). Valida el token (hash, vencimiento,
 * un solo uso), crea el usuario con el rol del miembro invitado, activa al miembro,
 * quema el token y devuelve la sesión igual que /register y /login.
 */
router.post(
  '/accept-invite',
  authRateLimit,
  acceptInviteRateLimit,
  validate(acceptInviteSchema),
  asyncHandler(async (req, res) => {
    const data = req.body as AcceptInviteInput;

    // Descarta tokens inexistentes/vencidos ANTES de gastar un hash Argon2 (CPU) en
    // un request anónimo. El canje de abajo revalida todo bajo lock.
    if (!(await isInviteTokenLive(data.token))) {
      auditAuthEvent('AUTH_INVITE_REJECTED', req, { metadata: { reason: 'invalid_or_expired' } });
      res.status(400).json({ error: INVITE_GENERIC_ERROR });
      return;
    }

    const passwordHash = await hashPassword(data.password);

    let accepted;
    try {
      accepted = await acceptInvite({ token: data.token, name: data.name, passwordHash });
    } catch (err) {
      if (err instanceof InviteError) {
        auditAuthEvent('AUTH_INVITE_REJECTED', req, { metadata: { reason: err.reason.toLowerCase() } });
        res.status(400).json({ error: INVITE_GENERIC_ERROR });
        return;
      }
      throw err;
    }

    const { user, business, memberId } = accepted;
    const token = signToken({ userId: user.id, businessId: business.id, role: user.role });
    setSessionCookie(res, token);

    auditAuthEvent('AUTH_INVITE_ACCEPTED', req, {
      userId: user.id,
      businessId: business.id,
      metadata: { memberId, role: user.role },
    });

    res.status(201).json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      business: { id: business.id, name: business.name, slug: business.slug },
    });
  })
);

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    try {
      const token = header.slice(7);
      const payload = jwt.verify(token, getAuthSecret(), { algorithms: [JWT_ALGORITHM] }) as { userId: string; businessId: string; role: string; iat?: number };
      // Misma revocación que requireAuth: un logout, cambio de rol o baja corta la
      // sesión también acá (antes /me seguía devolviendo datos con un JWT revocado).
      if (await isSessionRevoked(payload.businessId, payload.userId, payload.iat)) {
        res.status(401).json({ error: 'Session expired' });
        return;
      }
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        include: { business: true },
      });
      if (!user) {
        res.status(401).json({ error: 'User not found' });
        return;
      }
      // Cuenta dada de baja (p. ej. quitada del equipo): su JWT no sirve aunque no venza.
      if (user.isActive === false || user.deletedAt) {
        res.status(401).json({ error: 'User not found' });
        return;
      }
      if (user.business.isActive === false) {
        res.status(403).json({ error: 'Account suspended' });
        return;
      }
      res.json({
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
        business: { id: user.business.id, name: user.business.name, slug: user.business.slug },
      });
    } catch {
      res.status(401).json({ error: 'Invalid token' });
    }
  })
);

router.patch(
  '/me',
  authRateLimit,
  validate(updateMeSchema),
  asyncHandler(async (req, res) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    let payload: { userId: string; businessId: string; role: string; iat?: number };
    try {
      const token = header.slice(7);
      payload = jwt.verify(token, getAuthSecret(), { algorithms: [JWT_ALGORITHM] }) as typeof payload;
    } catch {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    if (await isSessionRevoked(payload.businessId, payload.userId, payload.iat)) {
      res.status(401).json({ error: 'Session expired' });
      return;
    }
    const current = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!current || current.isActive === false || current.deletedAt) {
      res.status(401).json({ error: 'User not found' });
      return;
    }
    if (!(await isBusinessActive(payload.businessId))) {
      res.status(403).json({ error: 'Account suspended' });
      return;
    }

    const { name, currentPassword, newPassword } = req.body;
    const update: Record<string, string> = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length < 2) {
        res.status(400).json({ error: 'Name must be at least 2 characters' });
        return;
      }
      update.name = name.trim();
    }

    if (newPassword) {
      if (!currentPassword) {
        res.status(400).json({ error: 'Current password is required' });
        return;
      }
      const { valid } = await verifyPassword(currentPassword, current.passwordHash);
      if (!valid) {
        res.status(400).json({ error: 'Current password is incorrect' });
        return;
      }
      // La fortaleza de newPassword ya la garantiza updateMeSchema (passwordSchema).
      update.passwordHash = await hashPassword(newPassword);
    }

    if (Object.keys(update).length === 0) {
      res.status(400).json({ error: 'Nothing to update' });
      return;
    }

    const updated = await prisma.user.update({
      where: { id: payload.userId },
      data: update,
      include: { business: true },
    });

    // Si cambió la contraseña, revocamos TODAS las sesiones emitidas hasta AHORA
    // (incluida la actual) y devolvemos un token nuevo. Antes el corte era el `iat`
    // del token actual: un atacante que se había logueado DESPUÉS de ese instante
    // seguía válido hasta 14 días con la clave ya cambiada.
    let newToken: string | undefined;
    if (update.passwordHash) {
      const cutoffMs = Date.now();
      await revokeUserSessions(payload.businessId, payload.userId, cutoffMs);
      // El token nuevo lleva un `iat` posterior al corte (el `iat` va en segundos
      // enteros y el corte en ms: se usa el segundo siguiente para que NO caiga del
      // lado revocado). Las sesiones anteriores quedan todas atrás.
      newToken = signToken(
        { userId: updated.id, businessId: updated.businessId, role: updated.role },
        Math.floor(cutoffMs / 1000) + 1,
      );
      setSessionCookie(res, newToken);
    }

    res.json({
      ...(newToken ? { token: newToken } : {}),
      user: { id: updated.id, email: updated.email, name: updated.name, role: updated.role },
      business: { id: updated.business.id, name: updated.business.name, slug: updated.business.slug },
    });
  })
);

router.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    clearSessionCookie(res);
    // Revocación server-side: el token de esta sesión queda inutilizable aunque
    // alguien lo haya copiado (antes el logout solo borraba la cookie local).
    await revokeUserSessions(req.auth!.businessId, req.auth!.userId);
    auditAuthEvent('AUTH_LOGOUT', req, { userId: req.auth!.userId, businessId: req.auth!.businessId });
    res.status(204).send();
  })
);

// ─── 2FA (TOTP) ──────────────────────────────────────────────────────

/** Estado de 2FA del usuario autenticado. */
router.get(
  '/2fa/status',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      select: { twoFactorEnabled: true },
    });
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    const recoveryCodesRemaining = user.twoFactorEnabled
      ? await countRecoveryCodes(req.auth!.businessId, req.auth!.userId)
      : 0;
    res.json({ enabled: user.twoFactorEnabled, recoveryCodesRemaining });
  })
);

/**
 * Inicia el alta de 2FA: genera un secreto (cifrado) y devuelve el QR/otpauth.
 * Deja twoFactorEnabled en false hasta que se verifique el primer código.
 */
router.post(
  '/2fa/setup',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      select: { email: true, twoFactorEnabled: true },
    });
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    if (user.twoFactorEnabled) { res.status(409).json({ error: '2FA ya está activo' }); return; }

    const setup = await generateTwoFactorSetup(user.email);
    await prisma.user.update({
      where: { id: req.auth!.userId },
      data: { twoFactorSecret: setup.encryptedSecret, twoFactorEnabled: false },
    });

    res.json({ otpauthUri: setup.otpauthUri, qrDataUrl: setup.qrDataUrl });
  })
);

/** Confirma el alta de 2FA verificando el primer código TOTP. */
router.post(
  '/2fa/verify',
  authRateLimit,
  requireAuth,
  twoFactorUserLimit,
  validate(twoFactorCodeSchema),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      select: { twoFactorSecret: true, twoFactorEnabled: true },
    });
    if (!user?.twoFactorSecret) { res.status(400).json({ error: 'Primero iniciá el alta de 2FA' }); return; }
    if (user.twoFactorEnabled) { res.status(409).json({ error: '2FA ya está activo' }); return; }

    if (!verifyTwoFactorToken(user.twoFactorSecret, req.body.code)) {
      res.status(400).json({ error: 'Código inválido' });
      return;
    }

    await prisma.user.update({ where: { id: req.auth!.userId }, data: { twoFactorEnabled: true } });
    auditAuthEvent('AUTH_2FA_ENABLED', req, { userId: req.auth!.userId, businessId: req.auth!.businessId });
    // Los códigos de recuperación se muestran UNA sola vez, junto con la activación.
    const recoveryCodes = await generateRecoveryCodes(req.auth!.businessId, req.auth!.userId);
    res.json({ enabled: true, recoveryCodes });
  })
);

/** Desactiva 2FA (requiere un código TOTP válido vigente). */
router.post(
  '/2fa/disable',
  authRateLimit,
  requireAuth,
  twoFactorUserLimit,
  validate(secondFactorCodeSchema),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      select: { twoFactorSecret: true, twoFactorEnabled: true },
    });
    if (!user?.twoFactorEnabled || !user.twoFactorSecret) {
      res.status(400).json({ error: '2FA no está activo' });
      return;
    }
    const valid = await verifySecondFactor({
      businessId: req.auth!.businessId,
      userId: req.auth!.userId,
      encryptedSecret: user.twoFactorSecret,
      code: req.body.code,
    });
    if (!valid) {
      res.status(400).json({ error: 'Código inválido' });
      return;
    }

    await prisma.user.update({
      where: { id: req.auth!.userId },
      data: { twoFactorEnabled: false, twoFactorSecret: null },
    });
    await clearRecoveryCodes(req.auth!.businessId, req.auth!.userId);
    auditAuthEvent('AUTH_2FA_DISABLED', req, { userId: req.auth!.userId, businessId: req.auth!.businessId });
    res.json({ enabled: false });
  })
);

/**
 * Emite un juego NUEVO de códigos de recuperación (invalida los anteriores).
 * Pide el segundo factor vigente para que una sesión robada no pueda rearmarlos.
 */
router.post(
  '/2fa/recovery-codes',
  authRateLimit,
  requireAuth,
  twoFactorUserLimit,
  validate(secondFactorCodeSchema),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      select: { twoFactorSecret: true, twoFactorEnabled: true },
    });
    if (!user?.twoFactorEnabled || !user.twoFactorSecret) {
      res.status(400).json({ error: '2FA no está activo' });
      return;
    }
    const valid = await verifySecondFactor({
      businessId: req.auth!.businessId,
      userId: req.auth!.userId,
      encryptedSecret: user.twoFactorSecret,
      code: req.body.code,
    });
    if (!valid) {
      res.status(400).json({ error: 'Código inválido' });
      return;
    }
    const recoveryCodes = await generateRecoveryCodes(req.auth!.businessId, req.auth!.userId);
    auditAuthEvent('AUTH_2FA_RECOVERY_REGENERATED', req, { userId: req.auth!.userId, businessId: req.auth!.businessId });
    res.json({ recoveryCodes });
  })
);

export { router as authRouter };
