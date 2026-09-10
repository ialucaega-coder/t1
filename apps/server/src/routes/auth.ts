import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { authRateLimit } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { z } from 'zod';
import { registerSchema, loginSchema, RegisterInput, LoginInput } from '../validators/auth';

const updateMeSchema = z.object({
  name: z.string().max(100).optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(6).max(100).optional(),
});
import { auditAuthEvent } from '../middleware/audit';
import type { Response } from 'express';

const router = Router();

// Duración del JWT y de la cookie de sesión asociada (14 días).
const JWT_EXPIRES_IN = '14d';
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

function signToken(payload: { userId: string; businessId: string; role: string }) {
  return jwt.sign(payload, process.env.NEXTAUTH_SECRET || 'dev-secret', {
    expiresIn: JWT_EXPIRES_IN,
  });
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

    const passwordHash = await bcrypt.hash(data.password, 12);
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
      auditAuthEvent('AUTH_LOGIN_FAILURE', req, { metadata: { reason: 'unknown_email' } });
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      auditAuthEvent('AUTH_ACCOUNT_LOCKED', req, { userId: user.id, businessId: user.businessId });
      res.status(423).json({ error: 'Account locked. Try again later.' });
      return;
    }

    const validPassword = await bcrypt.compare(data.password, user.passwordHash);
    if (!validPassword) {
      const failedLogins = user.failedLogins + 1;
      const update: { failedLogins: number; lockedUntil?: Date } = { failedLogins };
      if (failedLogins >= MAX_FAILED_LOGINS) {
        update.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
      }
      await prisma.user.update({ where: { id: user.id }, data: update });

      auditAuthEvent('AUTH_LOGIN_FAILURE', req, {
        userId: user.id,
        businessId: user.businessId,
        metadata: { failedLogins, locked: failedLogins >= MAX_FAILED_LOGINS },
      });

      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

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
      const payload = jwt.verify(token, process.env.NEXTAUTH_SECRET || 'dev-secret') as { userId: string; businessId: string; role: string };
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        include: { business: true },
      });
      if (!user) {
        res.status(401).json({ error: 'User not found' });
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
  validate(updateMeSchema),
  asyncHandler(async (req, res) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    let payload: { userId: string; businessId: string; role: string };
    try {
      const token = header.slice(7);
      payload = jwt.verify(token, process.env.NEXTAUTH_SECRET || 'dev-secret') as typeof payload;
    } catch {
      res.status(401).json({ error: 'Invalid token' });
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
      const user = await prisma.user.findUnique({ where: { id: payload.userId } });
      if (!user) { res.status(401).json({ error: 'User not found' }); return; }
      const valid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!valid) {
        res.status(400).json({ error: 'Current password is incorrect' });
        return;
      }
      if (newPassword.length < 6) {
        res.status(400).json({ error: 'New password must be at least 6 characters' });
        return;
      }
      update.passwordHash = await bcrypt.hash(newPassword, 12);
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

    res.json({
      user: { id: updated.id, email: updated.email, name: updated.name, role: updated.role },
      business: { id: updated.business.id, name: updated.business.name, slug: updated.business.slug },
    });
  })
);

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    clearSessionCookie(res);
    auditAuthEvent('AUTH_LOGOUT', req, { userId: req.auth?.userId, businessId: req.auth?.businessId });
    res.status(204).send();
  })
);

export { router as authRouter };
