/**
 * Auditoría de auth (routes/auth.ts):
 *  - cambio de contraseña: corte de revocación = AHORA + token nuevo (A3),
 *  - login de un negocio suspendido (A4),
 *  - bloqueo por intentos: incremento atómico, reset al vencer, timing igualado (M3),
 *  - límites de /2fa/verify, /2fa/disable y /2fa/recovery-codes (B2).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    business: { findUnique: vi.fn() },
  },
}));

const rateLimitPaths = vi.hoisted(() => [] as string[]);
vi.mock('../../middleware/rateLimit', () => ({
  authRateLimit: (req: { path: string }, _res: unknown, next: () => void) => {
    rateLimitPaths.push(req.path);
    next();
  },
  apiRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../../services/auth/revocation', () => ({
  revokeUserSessions: vi.fn(async () => undefined),
  isSessionRevoked: vi.fn(async () => false),
}));

vi.mock('../../lib/password', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/password')>();
  return { ...actual, equalizeVerifyTiming: vi.fn(async () => undefined) };
});

import { prisma } from '../../lib/prisma';
import { authRouter } from '../../routes/auth';
import { getAuthSecret } from '../../lib/secrets';
import { revokeUserSessions } from '../../services/auth/revocation';
import { equalizeVerifyTiming } from '../../lib/password';
import { invalidateBusinessActive } from '../../services/auth/businessStatus';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  return app;
}

describe('routes/auth: seguridad de sesión', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitPaths.length = 0;
    invalidateBusinessActive('biz_1');
    mock(prisma.business.findUnique).mockResolvedValue({ isActive: true });
  });

  describe('cambio de contraseña (A3)', () => {
    it('revoca con corte AHORA (no el iat del token actual) y devuelve un token nuevo que sobrevive al corte', async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      // Token actual emitido hace una hora; un atacante se logueó hace 5 minutos (iat posterior al del token actual).
      const current = jwt.sign({ userId: 'u1', businessId: 'biz_1', role: 'ADMIN', iat: nowSec - 3600 }, getAuthSecret());
      const attacker = jwt.sign({ userId: 'u1', businessId: 'biz_1', role: 'ADMIN', iat: nowSec - 300 }, getAuthSecret());
      const currentHash = await bcrypt.hash('ClaveActual1', 10);
      mock(prisma.user.findUnique).mockResolvedValue({ id: 'u1', isActive: true, deletedAt: null, passwordHash: currentHash });
      mock(prisma.user.update).mockResolvedValue({
        id: 'u1', email: 'a@x.com', name: 'Ana', role: 'ADMIN', businessId: 'biz_1',
        business: { id: 'biz_1', name: 'Biz', slug: 'biz' },
      });

      const before = Date.now();
      const res = await request(app)
        .patch('/api/auth/me')
        .set('Authorization', `Bearer ${current}`)
        .send({ currentPassword: 'ClaveActual1', newPassword: 'NuevaClave1' });
      const after = Date.now();

      expect(res.status).toBe(200);
      const [biz, uid, cutoff] = mock(revokeUserSessions).mock.calls[0];
      expect([biz, uid]).toEqual(['biz_1', 'u1']);
      // El corte es "ahora", no el iat del token actual.
      expect(cutoff).toBeGreaterThanOrEqual(before);
      expect(cutoff).toBeLessThanOrEqual(after);

      // Criterio de isSessionRevoked: iat*1000 < corte => revocado.
      const attackerIat = (jwt.decode(attacker) as { iat: number }).iat;
      const currentIat = (jwt.decode(current) as { iat: number }).iat;
      expect(attackerIat * 1000 < cutoff).toBe(true); // el atacante queda afuera
      expect(currentIat * 1000 < cutoff).toBe(true); // y el token viejo también

      // El token nuevo viene en la respuesta, verifica con HS256 y NO está del lado revocado.
      expect(typeof res.body.token).toBe('string');
      const decoded = jwt.verify(res.body.token, getAuthSecret(), { algorithms: ['HS256'] }) as { userId: string; businessId: string; role: string; iat: number };
      expect(decoded).toMatchObject({ userId: 'u1', businessId: 'biz_1', role: 'ADMIN' });
      expect(decoded.iat * 1000 < cutoff).toBe(false);
      // Y también actualiza la cookie de sesión.
      expect(String(res.headers['set-cookie'])).toContain('session_token=');
    });

    it('si solo cambia el nombre no revoca nada ni emite token', async () => {
      const current = jwt.sign({ userId: 'u1', businessId: 'biz_1', role: 'ADMIN' }, getAuthSecret());
      mock(prisma.user.findUnique).mockResolvedValue({ id: 'u1', isActive: true, deletedAt: null });
      mock(prisma.user.update).mockResolvedValue({
        id: 'u1', email: 'a@x.com', name: 'Ana Maria', role: 'ADMIN', businessId: 'biz_1',
        business: { id: 'biz_1', name: 'Biz', slug: 'biz' },
      });

      const res = await request(app).patch('/api/auth/me').set('Authorization', `Bearer ${current}`).send({ name: 'Ana Maria' });

      expect(res.status).toBe(200);
      expect(revokeUserSessions).not.toHaveBeenCalled();
      expect(res.body.token).toBeUndefined();
    });
  });

  describe('login con negocio suspendido (A4)', () => {
    const user = (over: Record<string, unknown> = {}) => ({
      id: 'u1', email: 'a@x.com', name: 'Ana', role: 'ADMIN', isActive: true, deletedAt: null,
      failedLogins: 0, lockedUntil: null, businessId: 'biz_1', twoFactorEnabled: false,
      business: { id: 'biz_1', name: 'Biz', slug: 'biz', isActive: false },
      ...over,
    });

    it('rechaza (403, mensaje genérico de cuenta suspendida) aunque la contraseña sea correcta, sin token', async () => {
      mock(prisma.user.findUnique).mockResolvedValue(user({ passwordHash: await bcrypt.hash('Password123', 10) }));

      const res = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'Password123' });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/suspendida/i);
      expect(res.body.token).toBeUndefined();
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('con contraseña incorrecta NO revela la suspensión (401 genérico)', async () => {
      mock(prisma.user.findUnique).mockResolvedValue(user({ passwordHash: await bcrypt.hash('Password123', 10) }));
      mock(prisma.user.update).mockResolvedValue({ failedLogins: 1 });

      const res = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'incorrecta1' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid credentials');
    });

    it('reactivado el negocio, el login vuelve a funcionar', async () => {
      mock(prisma.user.findUnique).mockResolvedValue(
        user({ passwordHash: await bcrypt.hash('Password123', 10), business: { id: 'biz_1', name: 'Biz', slug: 'biz', isActive: true } }),
      );
      mock(prisma.user.update).mockResolvedValue({});

      const res = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'Password123' });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeTruthy();
    });

    it('/me y PATCH /me también rechazan un negocio suspendido', async () => {
      const t = jwt.sign({ userId: 'u1', businessId: 'biz_1', role: 'ADMIN' }, getAuthSecret());
      mock(prisma.user.findUnique).mockResolvedValue(user());
      const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${t}`);
      expect(me.status).toBe(403);

      mock(prisma.business.findUnique).mockResolvedValue({ isActive: false });
      invalidateBusinessActive('biz_1');
      const patch = await request(app).patch('/api/auth/me').set('Authorization', `Bearer ${t}`).send({ name: 'Otro nombre' });
      expect(patch.status).toBe(403);
    });
  });

  describe('bloqueo por intentos fallidos (M3)', () => {
    const base = async (over: Record<string, unknown> = {}) => ({
      id: 'u1', email: 'a@x.com', name: 'Ana', role: 'ADMIN', isActive: true, deletedAt: null,
      failedLogins: 0, lockedUntil: null, businessId: 'biz_1', twoFactorEnabled: false,
      passwordHash: await bcrypt.hash('Password123', 10),
      business: { id: 'biz_1', name: 'Biz', slug: 'biz', isActive: true },
      ...over,
    });

    it('cuenta con increment atómico (nunca lee-suma-escribe) y no bloquea por debajo del tope', async () => {
      mock(prisma.user.findUnique).mockResolvedValue(await base());
      mock(prisma.user.update).mockResolvedValue({ failedLogins: 3 });

      const res = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'mala-clave1' });

      expect(res.status).toBe(401);
      expect(prisma.user.update).toHaveBeenCalledTimes(1);
      expect(mock(prisma.user.update).mock.calls[0][0]).toMatchObject({ where: { id: 'u1' }, data: { failedLogins: { increment: 1 } } });
    });

    it('con intentos paralelos el bloqueo se decide con el valor devuelto por la base, no con el leído antes', async () => {
      // Todos leyeron failedLogins=0, pero la base ya devuelve 5 para este intento.
      mock(prisma.user.findUnique).mockResolvedValue(await base({ failedLogins: 0 }));
      mock(prisma.user.update).mockResolvedValueOnce({ failedLogins: 5 }).mockResolvedValue({});

      await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'mala-clave1' });

      expect(mock(prisma.user.update).mock.calls[1][0].data.lockedUntil).toBeInstanceOf(Date);
    });

    it('un bloqueo VENCIDO resetea el contador: el primer error nuevo no vuelve a bloquear', async () => {
      mock(prisma.user.findUnique).mockResolvedValue(await base({ failedLogins: 5, lockedUntil: new Date(Date.now() - 1000) }));
      mock(prisma.user.update).mockResolvedValueOnce({}).mockResolvedValueOnce({ failedLogins: 1 });

      const res = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'mala-clave1' });

      expect(res.status).toBe(401);
      const calls = mock(prisma.user.update).mock.calls;
      expect(calls[0][0].data).toEqual({ failedLogins: 0, lockedUntil: null });
      expect(calls[1][0].data).toEqual({ failedLogins: { increment: 1 } });
      expect(calls).toHaveLength(2); // sin escritura de lockedUntil
    });

    it('un bloqueo vencido con la contraseña correcta entra normalmente', async () => {
      mock(prisma.user.findUnique).mockResolvedValue(await base({ failedLogins: 5, lockedUntil: new Date(Date.now() - 1000) }));
      mock(prisma.user.update).mockResolvedValue({});

      const res = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'Password123' });

      expect(res.status).toBe(200);
    });

    it('cuenta bloqueada e inactiva igualan el tiempo (corren el verify de relleno) y responden 401 genérico', async () => {
      mock(prisma.user.findUnique).mockResolvedValue(await base({ lockedUntil: new Date(Date.now() + 60_000) }));
      const locked = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'Password123' });
      expect(locked.status).toBe(401);
      expect(locked.body.error).toBe('Invalid credentials');
      expect(equalizeVerifyTiming).toHaveBeenCalledTimes(1);

      mock(prisma.user.findUnique).mockResolvedValue(await base({ isActive: false }));
      const inactive = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'Password123' });
      expect(inactive.status).toBe(401);
      expect(inactive.body.error).toBe('Invalid credentials');
      expect(equalizeVerifyTiming).toHaveBeenCalledTimes(2);
    });
  });

  describe('límites de los endpoints de 2FA (B2)', () => {
    const token = jwt.sign({ userId: 'u1', businessId: 'biz_1', role: 'ADMIN' }, getAuthSecret());

    it('/2fa/verify, /2fa/disable y /2fa/recovery-codes pasan por authRateLimit', async () => {
      mock(prisma.user.findUnique).mockResolvedValue({ twoFactorSecret: null, twoFactorEnabled: false });
      const auth = { Authorization: `Bearer ${token}` };

      await request(app).post('/api/auth/2fa/verify').set(auth).send({ code: '123456' });
      await request(app).post('/api/auth/2fa/disable').set(auth).send({ code: '123456' });
      await request(app).post('/api/auth/2fa/recovery-codes').set(auth).send({ code: '123456' });

      expect(rateLimitPaths).toEqual(expect.arrayContaining(['/2fa/verify', '/2fa/disable', '/2fa/recovery-codes']));
    });

    it('tope por USUARIO: tras 10 intentos de código en la ventana responde 429 (aunque cambie la IP)', async () => {
      const prev = process.env.TENANT_RL_FORCE;
      process.env.TENANT_RL_FORCE = 'true';
      try {
        mock(prisma.user.findUnique).mockResolvedValue({ twoFactorSecret: null, twoFactorEnabled: false });
        const userToken = jwt.sign({ userId: `u_rl_${Date.now()}`, businessId: 'biz_1', role: 'ADMIN' }, getAuthSecret());
        let last = 0;
        for (let i = 0; i < 11; i++) {
          const r = await request(app)
            .post('/api/auth/2fa/verify')
            .set('Authorization', `Bearer ${userToken}`)
            .set('X-Forwarded-For', `10.0.0.${i}`)
            .send({ code: '123456' });
          last = r.status;
          if (i < 10) expect(r.status).toBe(400);
        }
        expect(last).toBe(429);
      } finally {
        if (prev === undefined) delete process.env.TENANT_RL_FORCE;
        else process.env.TENANT_RL_FORCE = prev;
      }
    });
  });
});
