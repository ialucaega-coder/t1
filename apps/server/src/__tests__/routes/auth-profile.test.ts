/**
 * Pruebas de integración de PATCH /api/auth/me (`src/routes/auth.ts`):
 * cambio de nombre y de contraseña.
 *
 * Prisma, el rate limit y la revocación de sesiones se mockean. lib/password
 * (Argon2id + bcrypt legado) es REAL. Auth por JWT real firmado con el mismo
 * secreto que usa la ruta (getAuthSecret).
 *
 * Nota: el handler valida el body (validate(updateMeSchema)) ANTES de chequear
 * el header Authorization, por eso el caso "sin auth" envía un body válido para
 * llegar al 401 y no quedarse en un 400.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

vi.mock('../../lib/prisma', () => ({
  prisma: { user: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() } },
}));

// Rate limiting pass-through (su contador in-memory se acumularía entre tests).
vi.mock('../../middleware/rateLimit', () => ({
  authRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
  apiRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../../services/auth/revocation', () => ({
  revokeUserSessions: vi.fn(),
}));

import { prisma } from '../../lib/prisma';
import { authRouter } from '../../routes/auth';
import { hashPassword } from '../../lib/password';
import { getAuthSecret } from '../../lib/secrets';
import { revokeUserSessions } from '../../services/auth/revocation';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

const token = jwt.sign({ userId: 'u1', businessId: 'biz_1', role: 'ADMIN' }, getAuthSecret());
const auth = { Authorization: `Bearer ${token}` };

const CURRENT = 'ClaveActual1';
const NEW_STRONG = 'NuevaClave1';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  return app;
}

/** Fila devuelta por prisma.user.update (incluye business). */
const updatedRow = {
  id: 'u1',
  email: 'ana@x.com',
  name: 'Ana',
  role: 'ADMIN',
  business: { id: 'biz_1', name: 'Biz', slug: 'biz' },
};

beforeEach(() => {
  vi.clearAllMocks();
  mock(prisma.user.update).mockResolvedValue(updatedRow);
});

describe('routes/auth · PATCH /me', () => {
  const app = buildApp();

  describe('validación de newPassword', () => {
    it('rechaza (400) una newPassword débil sin tocar la DB', async () => {
      const res = await request(app)
        .patch('/api/auth/me').set(auth)
        .send({ currentPassword: CURRENT, newPassword: 'abc' });

      expect(res.status).toBe(400);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(revokeUserSessions).not.toHaveBeenCalled();
    });

    it('rechaza (400) una newPassword de 129 caracteres', async () => {
      const longPassword = 'Aa1' + 'x'.repeat(126); // 129 chars, cumple composición
      expect(longPassword).toHaveLength(129);

      const res = await request(app)
        .patch('/api/auth/me').set(auth)
        .send({ currentPassword: CURRENT, newPassword: longPassword });

      expect(res.status).toBe(400);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rechaza (400) si hay newPassword pero falta currentPassword', async () => {
      const res = await request(app)
        .patch('/api/auth/me').set(auth)
        .send({ newPassword: NEW_STRONG });

      expect(res.status).toBe(400);
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(revokeUserSessions).not.toHaveBeenCalled();
    });
  });

  describe('verificación de la contraseña actual', () => {
    it('rechaza (400) si currentPassword es incorrecta', async () => {
      mock(prisma.user.findUnique).mockResolvedValue({
        id: 'u1',
        passwordHash: await hashPassword('OtraClaveDistinta9'),
      });

      const res = await request(app)
        .patch('/api/auth/me').set(auth)
        .send({ currentPassword: CURRENT, newPassword: NEW_STRONG });

      expect(res.status).toBe(400);
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(revokeUserSessions).not.toHaveBeenCalled();
    });

    it('cambia la contraseña (hash Argon2id) y revoca las sesiones anteriores', async () => {
      mock(prisma.user.findUnique).mockResolvedValue({
        id: 'u1',
        passwordHash: await hashPassword(CURRENT),
      });

      const res = await request(app)
        .patch('/api/auth/me').set(auth)
        .send({ currentPassword: CURRENT, newPassword: NEW_STRONG });

      expect(res.status).toBe(200);
      expect(res.body.user).toEqual({ id: 'u1', email: 'ana@x.com', name: 'Ana', role: 'ADMIN' });
      expect(res.body.business).toEqual({ id: 'biz_1', name: 'Biz', slug: 'biz' });

      const updateArg = mock(prisma.user.update).mock.calls[0][0];
      expect(updateArg.where).toEqual({ id: 'u1' });
      expect(updateArg.data.passwordHash).toMatch(/^\$argon2id\$/);
      expect(updateArg.data.passwordHash).not.toContain(NEW_STRONG);

      expect(revokeUserSessions).toHaveBeenCalledTimes(1);
      const [businessId, userId, cutoffMs] = mock(revokeUserSessions).mock.calls[0];
      expect(businessId).toBe('biz_1');
      expect(userId).toBe('u1');
      expect(typeof cutoffMs).toBe('number');
    });

    it('acepta un hash bcrypt legado como contraseña actual', async () => {
      mock(prisma.user.findUnique).mockResolvedValue({
        id: 'u1',
        passwordHash: await bcrypt.hash(CURRENT, 10),
      });

      const res = await request(app)
        .patch('/api/auth/me').set(auth)
        .send({ currentPassword: CURRENT, newPassword: NEW_STRONG });

      expect(res.status).toBe(200);
      // El nuevo hash se guarda ya migrado a Argon2id.
      expect(mock(prisma.user.update).mock.calls[0][0].data.passwordHash).toMatch(/^\$argon2id\$/);
      expect(revokeUserSessions).toHaveBeenCalledTimes(1);
    });
  });

  describe('cambio de nombre', () => {
    it('actualiza solo el nombre, sin passwordHash ni revocar sesiones', async () => {
      const res = await request(app)
        .patch('/api/auth/me').set(auth)
        .send({ name: '  Ana María  ' });

      expect(res.status).toBe(200);
      const data = mock(prisma.user.update).mock.calls[0][0].data;
      expect(data).toEqual({ name: 'Ana María' });
      expect(data).not.toHaveProperty('passwordHash');
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(revokeUserSessions).not.toHaveBeenCalled();
    });
  });

  describe('autenticación', () => {
    it('responde 401 sin header Authorization', async () => {
      const res = await request(app)
        .patch('/api/auth/me')
        .send({ name: 'Ana' });

      expect(res.status).toBe(401);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
