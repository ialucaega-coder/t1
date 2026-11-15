/**
 * Flujo de invitaciones y roles del equipo (`routes/team.ts`): invitar (PENDING + token
 * hasheado + mail), reenviar, revocar al quitar, sincronizar User.role y proteger al
 * último ADMIN. Prisma en memoria (helpers/team-fake-db); auth por headers de test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../../lib/prisma', async () => {
  const { createFakeDb } = await import('../helpers/team-fake-db');
  return { prisma: createFakeDb() };
});
vi.mock('../../lib/redis', () => ({ getRedis: () => null }));

vi.mock('../../middleware/auth', async (importOriginal) => ({
  // requireStaff es el REAL: se prueba que un CLIENT no lista el equipo.
  ...(await importOriginal<typeof import('../../middleware/auth')>()),
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = {
      userId: String(req.header('x-uid') ?? 'admin_1'),
      businessId: String(req.header('x-biz') ?? 'biz_1'),
      role: String(req.header('x-role') ?? 'ADMIN') as 'ADMIN',
    };
    next();
  },
  requireRole:
    (...roles: string[]) =>
    (req: Request, res: Response, next: NextFunction) => {
      if (!roles.includes(req.auth?.role ?? '')) {
        res.status(403).json({ error: 'Insufficient permissions' });
        return;
      }
      next();
    },
}));

vi.mock('../../middleware/audit', () => ({ recordAuditEvent: vi.fn() }));
vi.mock('../../services/email', () => ({ sendTeamInviteEmail: vi.fn(async () => true) }));
vi.mock('../../services/auth/revocation', () => ({ revokeUserSessions: vi.fn(async () => undefined) }));

import { prisma } from '../../lib/prisma';
import type { FakeDb } from '../helpers/team-fake-db';
import { teamRouter } from '../../routes/team';
import { errorHandler } from '../../middleware/errorHandler';
import { sendTeamInviteEmail } from '../../services/email';
import { recordAuditEvent } from '../../middleware/audit';
import { revokeUserSessions } from '../../services/auth/revocation';
import { acceptInvite, hashInviteToken, InviteError, issueInviteTx } from '../../services/team/invitations';
import { cache } from '../../lib/cache';

const db = prisma as unknown as FakeDb;
const mailMock = sendTeamInviteEmail as unknown as ReturnType<typeof vi.fn>;
const revokeMock = revokeUserSessions as unknown as ReturnType<typeof vi.fn>;
const auditMock = recordAuditEvent as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/team', teamRouter);
  app.use(errorHandler);
  return app;
}

/** Extrae el token del link que se mandó por mail en la última invocación. */
function tokenFromLastMail(): string {
  const call = mailMock.mock.calls.at(-1)!;
  const url = (call[1] as { acceptUrl: string }).acceptUrl;
  return decodeURIComponent(url.split('#token=')[1]);
}

async function acceptReason(token: string): Promise<string | null> {
  try {
    await acceptInvite({ token, name: 'Ana', passwordHash: 'h' });
    return null;
  } catch (err) {
    if (err instanceof InviteError) return err.reason;
    throw err;
  }
}

const SAVED_ENV = { ...process.env };

describe('routes/team (invitaciones y roles)', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    revokeMock.mockReset();
    revokeMock.mockResolvedValue(undefined);
    cache.clear();
    db.reset();
    db.seedBusiness('biz_1', 'Peluquería Sol');
    db.seedBusiness('biz_2', 'Otro Negocio');
    // El dueño del negocio (registro): ADMIN sin fila de TeamMember.
    db.seedUser({ id: 'admin_1', email: 'owner@example.com', businessId: 'biz_1', role: 'ADMIN' });
    process.env.FRONTEND_URL = 'https://panel.test.example';
    mailMock.mockResolvedValue(true);
  });

  afterEach(() => {
    process.env = { ...SAVED_ENV };
  });

  describe('POST /api/team/invite', () => {
    it('crea el miembro PENDING, guarda solo el hash del token y manda el mail con el link', async () => {
      const res = await request(app).post('/api/team/invite').send({ email: 'Nueva@Example.com', role: 'PROFESSIONAL' });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        email: 'nueva@example.com',
        role: 'PROFESSIONAL',
        status: 'PENDING',
        businessId: 'biz_1',
        emailSent: true,
      });
      expect(Date.parse(res.body.inviteExpiresAt)).toBeGreaterThan(Date.now() + 6.9 * 24 * 3600 * 1000);

      expect(mailMock).toHaveBeenCalledTimes(1);
      const [to, data] = mailMock.mock.calls[0];
      expect(to).toBe('nueva@example.com');
      expect(data.acceptUrl).toMatch(/^https:\/\/panel\.test\.example\/aceptar-invitacion#token=biz_1\./);
      expect(data.businessName).toBe('Peluquería Sol');
      expect(data.roleLabel).toBe('Profesional');

      // El token solo existe en el mail: en la base está su hash, nunca el valor.
      const token = tokenFromLastMail();
      expect(db.dump()).not.toContain(token);
      expect(db.dump()).not.toContain(token.split('.')[1]);
      const stored = db.invitesConfig('biz_1').invites[res.body.id];
      expect(stored.tokenHash).toBe(hashInviteToken(token));
      expect(stored.email).toBe('nueva@example.com');
      // El body de la API tampoco expone nada del token.
      expect(JSON.stringify(res.body)).not.toContain(token);

      // Se audita el envío, sin el token ni el link en la metadata.
      expect(auditMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'TEAM_INVITE_SENT', businessId: 'biz_1', userId: 'admin_1' }),
      );
      expect(JSON.stringify(auditMock.mock.calls)).not.toContain(token.split('.')[1]);
    });

    it('el link usa FRONTEND_URL (sin dominio hardcodeado) y nunca el token como query', async () => {
      process.env.FRONTEND_URL = 'https://otro-dominio.example/';
      await request(app).post('/api/team/invite').send({ email: 'a@example.com' });
      const url = mailMock.mock.calls[0][1].acceptUrl as string;
      expect(url.startsWith('https://otro-dominio.example/aceptar-invitacion#token=')).toBe(true);
      expect(url).not.toContain('?');
    });

    it('si el mail no sale, igual crea la invitación y lo dice (emailSent: false)', async () => {
      mailMock.mockResolvedValue(false);
      const res = await request(app).post('/api/team/invite').send({ email: 'a@example.com' });

      expect(res.status).toBe(201);
      expect(res.body.emailSent).toBe(false);
      expect(db.invitesConfig('biz_1').invites[res.body.id]).toBeDefined();
    });

    it('en producción sin FRONTEND_URL no arma un link roto: no manda y avisa', async () => {
      delete process.env.FRONTEND_URL;
      process.env.NODE_ENV = 'production';
      const res = await request(app).post('/api/team/invite').send({ email: 'a@example.com' });

      expect(res.status).toBe(201);
      expect(res.body.emailSent).toBe(false);
      expect(mailMock).not.toHaveBeenCalled();
    });

    it('devuelve 409 si el email ya es miembro del equipo', async () => {
      db.seedMember({ businessId: 'biz_1', email: 'ya@example.com' });
      const res = await request(app).post('/api/team/invite').send({ email: 'YA@example.com' });
      expect(res.status).toBe(409);
      expect(mailMock).not.toHaveBeenCalled();
    });

    it('devuelve 409 si ese email ya tiene una cuenta activa en el MISMO negocio', async () => {
      const res = await request(app).post('/api/team/invite').send({ email: 'owner@example.com' });
      expect(res.status).toBe(409);
      expect(db.state.teamMembers).toHaveLength(0);
    });

    it('un email que ya existe en OTRO negocio responde igual que uno nuevo (no revela cuentas)', async () => {
      db.seedUser({ email: 'existe@example.com', businessId: 'biz_2', role: 'ADMIN' });
      const existing = await request(app).post('/api/team/invite').send({ email: 'existe@example.com', role: 'VIEWER' });
      const fresh = await request(app).post('/api/team/invite').send({ email: 'nuevo@example.com', role: 'VIEWER' });

      expect(existing.status).toBe(201);
      expect(fresh.status).toBe(201);
      expect(Object.keys(existing.body).sort()).toEqual(Object.keys(fresh.body).sort());
      expect(existing.body.emailSent).toBe(fresh.body.emailSent);
      expect(existing.body.status).toBe('PENDING');
    });

    it('permite re-invitar a alguien que fue quitado (su cuenta quedó dada de baja en este negocio)', async () => {
      db.seedUser({ id: 'ex', email: 'ex@example.com', businessId: 'biz_1', role: 'PROFESSIONAL', isActive: false });
      const res = await request(app).post('/api/team/invite').send({ email: 'ex@example.com', role: 'PROFESSIONAL' });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('PENDING');
    });

    it('devuelve 400 sin email o con un rol inválido', async () => {
      expect((await request(app).post('/api/team/invite').send({ role: 'PROFESSIONAL' })).status).toBe(400);
      expect((await request(app).post('/api/team/invite').send({ email: 'a@example.com', role: 'SUPERADMIN' })).status).toBe(400);
      expect(db.state.teamMembers).toHaveLength(0);
    });

    it('solo un ADMIN puede invitar (403 para otro rol)', async () => {
      const res = await request(app).post('/api/team/invite').set('x-role', 'PROFESSIONAL').send({ email: 'a@example.com' });
      expect(res.status).toBe(403);
      expect(db.state.teamMembers).toHaveLength(0);
    });

    it('rate limit por negocio: la invitación 21 de la hora recibe 429; otro negocio no se ve afectado', async () => {
      process.env.TENANT_RL_FORCE = 'true';
      for (let i = 0; i < 20; i++) {
        const ok = await request(app).post('/api/team/invite').send({ email: `u${i}@example.com` });
        expect(ok.status).toBe(201);
      }
      const blocked = await request(app).post('/api/team/invite').send({ email: 'u21@example.com' });
      expect(blocked.status).toBe(429);
      expect(blocked.headers['retry-after']).toBeDefined();
      expect(db.state.teamMembers.some((m: any) => m.email === 'u21@example.com')).toBe(false);

      const otherBiz = await request(app).post('/api/team/invite').set('x-biz', 'biz_2').send({ email: 'x@example.com' });
      expect(otherBiz.status).toBe(201);
    });
  });

  describe('LOW-1: log del link de invitación', () => {
    function loggedLink(): boolean {
      return logSpy.mock.calls.some((c) => String(c[0]).includes('#token='));
    }
    let logSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => logSpy.mockRestore());

    it('NO se loguea en desarrollo si no está el flag explícito DEV_LOG_INVITE_LINKS=1', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.DEV_LOG_INVITE_LINKS;
      await request(app).post('/api/team/invite').send({ email: 'a@example.com' });
      expect(loggedLink()).toBe(false);
    });

    it('se loguea solo con NODE_ENV=development Y el flag en 1', async () => {
      process.env.NODE_ENV = 'development';
      process.env.DEV_LOG_INVITE_LINKS = '1';
      await request(app).post('/api/team/invite').send({ email: 'a@example.com' });
      expect(loggedLink()).toBe(true);
    });

    it('NUNCA en producción, aunque el flag esté puesto', async () => {
      process.env.NODE_ENV = 'production';
      process.env.DEV_LOG_INVITE_LINKS = '1';
      await request(app).post('/api/team/invite').send({ email: 'a@example.com' });
      expect(loggedLink()).toBe(false);
    });

    it('ni en test/otros entornos con el flag', async () => {
      process.env.DEV_LOG_INVITE_LINKS = '1';
      await request(app).post('/api/team/invite').send({ email: 'a@example.com' });
      expect(loggedLink()).toBe(false);
    });
  });

  describe('LOW-2: GET /api/team/members es solo para staff', () => {
    it('un CLIENT recibe 403 y no ve emails del equipo', async () => {
      db.seedMember({ businessId: 'biz_1', email: 'secreto@example.com' });
      const res = await request(app).get('/api/team/members').set('x-role', 'CLIENT');
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain('secreto@example.com');
    });

    it('un PROFESSIONAL (staff) sí puede listarlo', async () => {
      db.seedMember({ businessId: 'biz_1', email: 'a@example.com' });
      const res = await request(app).get('/api/team/members').set('x-role', 'PROFESSIONAL');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });
  });

  describe('MEDIUM-2: revocación de sesiones con reintentos', () => {
    function activePro() {
      const member = db.seedMember({ businessId: 'biz_1', email: 'pro@example.com', role: 'PROFESSIONAL', status: 'ACTIVE' });
      db.seedUser({ id: 'pro_user', email: 'pro@example.com', businessId: 'biz_1', role: 'PROFESSIONAL' });
      return member;
    }

    it('reintenta: si falla las dos primeras veces y a la tercera sale, no hay advertencia', async () => {
      const member = activePro();
      revokeMock.mockRejectedValueOnce(new Error('db')).mockRejectedValueOnce(new Error('db'));
      const res = await request(app).patch(`/api/team/members/${member.id}`).send({ role: 'ADMIN' });

      expect(res.status).toBe(200);
      expect(res.body.revocationFailed).toBeUndefined();
      expect(revokeMock).toHaveBeenCalledTimes(3);
    });

    it('PATCH: si la revocación falla siempre, devuelve 200 (el rol ya cambió) con revocationFailed y log de error', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const member = activePro();
      revokeMock.mockRejectedValue(new Error('redis caído'));
      const res = await request(app).patch(`/api/team/members/${member.id}`).send({ role: 'ADMIN' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ role: 'ADMIN', revocationFailed: true });
      expect(db.state.users.find((u: any) => u.id === 'pro_user').role).toBe('ADMIN');
      expect(revokeMock).toHaveBeenCalledTimes(3);
      expect(errSpy.mock.calls.some((c) => String(c[0]).includes('ERROR'))).toBe(true);
      errSpy.mockRestore();
      revokeMock.mockResolvedValue(undefined);
    });

    it('DELETE: si la revocación falla siempre, devuelve 200 {revocationFailed} en vez de un 500 engañoso', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const member = activePro();
      revokeMock.mockRejectedValue(new Error('redis caído'));
      const res = await request(app).delete(`/api/team/members/${member.id}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, revocationFailed: true });
      expect(db.state.teamMembers).toHaveLength(0);
      expect(db.state.users.find((u: any) => u.id === 'pro_user').isActive).toBe(false);
      errSpy.mockRestore();
      revokeMock.mockResolvedValue(undefined);
    });

    it('DELETE sin fallos sigue respondiendo 204 sin cuerpo', async () => {
      const member = activePro();
      revokeMock.mockResolvedValue(undefined);
      const res = await request(app).delete(`/api/team/members/${member.id}`);
      expect(res.status).toBe(204);
    });
  });

  describe('MEDIUM-1: canje vs DELETE/PATCH (ambos órdenes)', () => {
    it('DELETE primero, canje después: el token está revocado, no se crea ningún usuario', async () => {
      const invite = await request(app).post('/api/team/invite').send({ email: 'a@example.com', role: 'ADMIN' });
      const token = tokenFromLastMail();
      await request(app).delete(`/api/team/members/${invite.body.id}`);

      expect(await acceptReason(token)).toBe('INVALID');
      expect(db.state.users.filter((u: any) => u.email === 'a@example.com')).toHaveLength(0);
    });

    it('canje primero, DELETE después: el DELETE encuentra al usuario y lo da de baja (no queda un User activo sin fila de equipo)', async () => {
      const invite = await request(app).post('/api/team/invite').send({ email: 'a@example.com', role: 'ADMIN' });
      expect(await acceptReason(tokenFromLastMail())).toBeNull();
      expect(db.state.users.find((u: any) => u.email === 'a@example.com').isActive).toBe(true);

      const res = await request(app).delete(`/api/team/members/${invite.body.id}`);
      expect(res.status).toBe(204);
      expect(db.state.users.find((u: any) => u.email === 'a@example.com').isActive).toBe(false);
      expect(db.state.teamMembers).toHaveLength(0);
    });

    it('PATCH primero, canje después: el usuario nace con el rol NUEVO', async () => {
      const invite = await request(app).post('/api/team/invite').send({ email: 'a@example.com', role: 'ADMIN' });
      const token = tokenFromLastMail();
      await request(app).patch(`/api/team/members/${invite.body.id}`).send({ role: 'PROFESSIONAL' });

      await acceptInvite({ token, name: 'Ana', passwordHash: 'h' });
      expect(db.state.users.find((u: any) => u.email === 'a@example.com').role).toBe('PROFESSIONAL');
    });

    it('canje primero, PATCH después: el rol cambia en el User recién creado', async () => {
      const invite = await request(app).post('/api/team/invite').send({ email: 'a@example.com', role: 'PROFESSIONAL' });
      await acceptInvite({ token: tokenFromLastMail(), name: 'Ana', passwordHash: 'h' });

      const res = await request(app).patch(`/api/team/members/${invite.body.id}`).send({ role: 'VIEWER' });
      expect(res.status).toBe(200);
      expect(db.state.users.find((u: any) => u.email === 'a@example.com').role).toBe('CLIENT');
    });

    it('DELETE: la invitación se revoca ANTES de resolver el usuario vinculado (mismo orden de locks que el canje)', async () => {
      const invite = await request(app).post('/api/team/invite').send({ email: 'a@example.com' });
      db.connection.update.mockClear();
      db.user.findUnique.mockClear();

      await request(app).delete(`/api/team/members/${invite.body.id}`);
      const revokeAt = db.connection.update.mock.invocationCallOrder[0];
      const linkedAt = db.user.findUnique.mock.invocationCallOrder[0];
      expect(revokeAt).toBeLessThan(linkedAt);
    });

    it('si el DELETE falla por "último admin", la invitación NO queda revocada (todo se deshace)', async () => {
      const member = db.seedMember({ businessId: 'biz_1', email: 'owner@example.com', role: 'ADMIN', status: 'ACTIVE' });
      await db.$transaction((tx: any) => issueInviteTx(tx, 'biz_1', member.id, 'owner@example.com'));

      const res = await request(app).delete(`/api/team/members/${member.id}`);
      expect(res.status).toBe(409);
      expect(db.invitesConfig('biz_1').invites[member.id]).toBeDefined();
    });
  });

  describe('GET /api/team/members', () => {
    it('lista solo los miembros del negocio, con el vencimiento de la invitación y sin hashes', async () => {
      await request(app).post('/api/team/invite').send({ email: 'a@example.com' });
      db.seedMember({ businessId: 'biz_2', email: 'ajeno@example.com' });

      const res = await request(app).get('/api/team/members');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({ email: 'a@example.com', status: 'PENDING' });
      expect(res.body[0].inviteExpiresAt).toBeTruthy();
      expect(JSON.stringify(res.body)).not.toMatch(/[0-9a-f]{64}/);
      expect(JSON.stringify(res.body)).not.toContain('tokenHash');
    });
  });

  describe('POST /api/team/members/:id/resend', () => {
    it('emite un token nuevo y el anterior deja de servir', async () => {
      const invite = await request(app).post('/api/team/invite').send({ email: 'a@example.com', role: 'PROFESSIONAL' });
      const oldToken = tokenFromLastMail();

      const res = await request(app).post(`/api/team/members/${invite.body.id}/resend`);
      expect(res.status).toBe(200);
      expect(res.body.emailSent).toBe(true);
      expect(mailMock).toHaveBeenCalledTimes(2);

      const newToken = tokenFromLastMail();
      expect(newToken).not.toBe(oldToken);
      expect(db.dump()).not.toContain(newToken);
      expect(await acceptReason(oldToken)).toBe('INVALID');
      expect(await acceptReason(newToken)).toBeNull();
    });

    it('404 para un miembro de otro negocio (multi-tenant) y sin mandar mail', async () => {
      const foreign = db.seedMember({ businessId: 'biz_2', email: 'ajeno@example.com' });
      const res = await request(app).post(`/api/team/members/${foreign.id}/resend`);
      expect(res.status).toBe(404);
      expect(mailMock).not.toHaveBeenCalled();
    });

    it('409 si el miembro ya aceptó (ACTIVE)', async () => {
      const member = db.seedMember({ businessId: 'biz_1', email: 'activo@example.com', status: 'ACTIVE' });
      const res = await request(app).post(`/api/team/members/${member.id}/resend`);
      expect(res.status).toBe(409);
      expect(mailMock).not.toHaveBeenCalled();
    });

    it('solo ADMIN (403) y con el mismo rate limit por negocio (429)', async () => {
      const member = db.seedMember({ businessId: 'biz_1', email: 'p@example.com' });
      expect((await request(app).post(`/api/team/members/${member.id}/resend`).set('x-role', 'VIEWER')).status).toBe(403);

      process.env.TENANT_RL_FORCE = 'true';
      for (let i = 0; i < 20; i++) {
        expect((await request(app).post(`/api/team/members/${member.id}/resend`)).status).toBe(200);
      }
      expect((await request(app).post(`/api/team/members/${member.id}/resend`)).status).toBe(429);
    });
  });

  describe('DELETE /api/team/members/:id', () => {
    it('revoca la invitación pendiente: el link deja de servir', async () => {
      const invite = await request(app).post('/api/team/invite').send({ email: 'a@example.com' });
      const token = tokenFromLastMail();

      const res = await request(app).delete(`/api/team/members/${invite.body.id}`);
      expect(res.status).toBe(204);
      expect(db.state.teamMembers).toHaveLength(0);
      expect(db.invitesConfig('biz_1').invites[invite.body.id]).toBeUndefined();
      expect(await acceptReason(token)).toBe('INVALID');
      expect(db.state.users.filter((u: any) => u.email === 'a@example.com')).toHaveLength(0);
      expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'TEAM_INVITE_REVOKED' }));
    });

    it('404 para un miembro de otro negocio y no toca su fila ni su cuenta', async () => {
      const foreign = db.seedMember({ businessId: 'biz_2', email: 'ajeno@example.com', status: 'ACTIVE' });
      db.seedUser({ id: 'ajeno_user', email: 'ajeno@example.com', businessId: 'biz_2', role: 'PROFESSIONAL' });

      const res = await request(app).delete(`/api/team/members/${foreign.id}`);
      expect(res.status).toBe(404);
      expect(db.state.teamMembers).toHaveLength(1);
      expect(db.state.users.find((u: any) => u.id === 'ajeno_user').isActive).toBe(true);
    });

    it('quitar a un miembro activo da de baja su cuenta y cierra sus sesiones', async () => {
      const member = db.seedMember({ businessId: 'biz_1', email: 'pro@example.com', role: 'PROFESSIONAL', status: 'ACTIVE' });
      db.seedUser({ id: 'pro_user', email: 'pro@example.com', businessId: 'biz_1', role: 'PROFESSIONAL' });

      const res = await request(app).delete(`/api/team/members/${member.id}`);
      expect(res.status).toBe(204);
      expect(db.state.users.find((u: any) => u.id === 'pro_user').isActive).toBe(false);
      expect(revokeMock).toHaveBeenCalledWith('biz_1', 'pro_user');
    });

    it('no deja al negocio sin administradores: 409 si es el último ADMIN', async () => {
      const member = db.seedMember({ businessId: 'biz_1', email: 'owner@example.com', role: 'ADMIN', status: 'ACTIVE' });

      const res = await request(app).delete(`/api/team/members/${member.id}`);
      expect(res.status).toBe(409);
      expect(db.state.teamMembers).toHaveLength(1);
      expect(db.state.users.find((u: any) => u.id === 'admin_1').isActive).toBe(true);
      expect(revokeMock).not.toHaveBeenCalled();
    });

    it('sí puede quitar a un ADMIN si queda otro administrador activo', async () => {
      const member = db.seedMember({ businessId: 'biz_1', email: 'co@example.com', role: 'ADMIN', status: 'ACTIVE' });
      db.seedUser({ id: 'co_user', email: 'co@example.com', businessId: 'biz_1', role: 'ADMIN' });

      const res = await request(app).delete(`/api/team/members/${member.id}`);
      expect(res.status).toBe(204);
      expect(db.state.users.find((u: any) => u.id === 'co_user').isActive).toBe(false);
      expect(db.state.users.find((u: any) => u.id === 'admin_1').isActive).toBe(true);
    });

    it('un ADMIN inactivo de otro negocio no cuenta como "otro administrador"', async () => {
      db.seedUser({ id: 'adm_biz2', email: 'adm2@example.com', businessId: 'biz_2', role: 'ADMIN' });
      db.seedUser({ id: 'adm_inactivo', email: 'inactivo@example.com', businessId: 'biz_1', role: 'ADMIN', isActive: false });
      const member = db.seedMember({ businessId: 'biz_1', email: 'owner@example.com', role: 'ADMIN', status: 'ACTIVE' });

      const res = await request(app).delete(`/api/team/members/${member.id}`);
      expect(res.status).toBe(409);
    });
  });

  describe('PATCH /api/team/members/:id (rol sincronizado con User.role)', () => {
    function activeMember(email: string, role: string, userRole: string, userId: string) {
      const member = db.seedMember({ businessId: 'biz_1', email, role, status: 'ACTIVE' });
      db.seedUser({ id: userId, email, businessId: 'biz_1', role: userRole });
      return member;
    }

    it('cambia TeamMember.role Y User.role, y cierra sesiones para que el rol nuevo rija ya', async () => {
      const member = activeMember('pro@example.com', 'PROFESSIONAL', 'PROFESSIONAL', 'pro_user');

      const res = await request(app).patch(`/api/team/members/${member.id}`).send({ role: 'ADMIN' });
      expect(res.status).toBe(200);
      expect(res.body.role).toBe('ADMIN');
      expect(db.state.users.find((u: any) => u.id === 'pro_user').role).toBe('ADMIN');
      expect(revokeMock).toHaveBeenCalledWith('biz_1', 'pro_user');
      expect(auditMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'TEAM_ROLE_CHANGED',
          metadata: expect.objectContaining({ from: 'PROFESSIONAL', to: 'ADMIN', userSynced: true }),
        }),
      );
    });

    it('VIEWER se mapea a CLIENT en el login (mínimo privilegio)', async () => {
      const member = activeMember('pro@example.com', 'PROFESSIONAL', 'PROFESSIONAL', 'pro_user');
      await request(app).patch(`/api/team/members/${member.id}`).send({ role: 'VIEWER' });
      expect(db.state.users.find((u: any) => u.id === 'pro_user').role).toBe('CLIENT');
    });

    it('un miembro PENDING (sin cuenta aún) solo cambia el rol del miembro: se aplicará al canjear', async () => {
      const member = db.seedMember({ businessId: 'biz_1', email: 'p@example.com', role: 'VIEWER', status: 'PENDING' });
      const res = await request(app).patch(`/api/team/members/${member.id}`).send({ role: 'PROFESSIONAL' });
      expect(res.status).toBe(200);
      expect(revokeMock).not.toHaveBeenCalled();
      expect(db.state.users).toHaveLength(1);
    });

    it('no puede degradar al último ADMIN (otro miembro) -> 409 y nada cambia', async () => {
      // El único admin del negocio es co_user (el "owner" de la semilla se pasa a PROFESSIONAL).
      db.state.users.find((u: any) => u.id === 'admin_1').role = 'PROFESSIONAL';
      const member = activeMember('co@example.com', 'ADMIN', 'ADMIN', 'co_user');

      const res = await request(app).patch(`/api/team/members/${member.id}`).send({ role: 'PROFESSIONAL' });
      expect(res.status).toBe(409);
      expect(db.state.users.find((u: any) => u.id === 'co_user').role).toBe('ADMIN');
      expect(db.state.teamMembers.find((m: any) => m.id === member.id).role).toBe('ADMIN');
      expect(revokeMock).not.toHaveBeenCalled();
    });

    it('un ADMIN no puede quitarse a sí mismo el rol si es el único', async () => {
      const member = activeMember('owner-m@example.com', 'ADMIN', 'ADMIN', 'self');
      // El actor es el único administrador (admin_1 deja de serlo para esta prueba).
      db.state.users.find((u: any) => u.id === 'admin_1').role = 'PROFESSIONAL';

      const res = await request(app).patch(`/api/team/members/${member.id}`).set('x-uid', 'self').send({ role: 'VIEWER' });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/único administrador/);
      expect(db.state.users.find((u: any) => u.id === 'self').role).toBe('ADMIN');
    });

    it('sí puede degradar a un ADMIN si queda otro administrador activo', async () => {
      const member = activeMember('co@example.com', 'ADMIN', 'ADMIN', 'co_user');
      const res = await request(app).patch(`/api/team/members/${member.id}`).send({ role: 'PROFESSIONAL' });
      expect(res.status).toBe(200);
      expect(db.state.users.find((u: any) => u.id === 'co_user').role).toBe('PROFESSIONAL');
    });

    it('no sincroniza ni toca a un usuario con el mismo email de OTRO negocio (multi-tenant)', async () => {
      const member = db.seedMember({ businessId: 'biz_1', email: 'compartido@example.com', role: 'PROFESSIONAL', status: 'ACTIVE' });
      db.seedUser({ id: 'otro_negocio', email: 'compartido@example.com', businessId: 'biz_2', role: 'PROFESSIONAL' });

      const res = await request(app).patch(`/api/team/members/${member.id}`).send({ role: 'ADMIN' });
      expect(res.status).toBe(200);
      expect(db.state.users.find((u: any) => u.id === 'otro_negocio').role).toBe('PROFESSIONAL');
      expect(revokeMock).not.toHaveBeenCalled();
    });

    it('404 para un miembro de otro negocio', async () => {
      const foreign = db.seedMember({ businessId: 'biz_2', email: 'ajeno@example.com', role: 'VIEWER' });
      const res = await request(app).patch(`/api/team/members/${foreign.id}`).send({ role: 'ADMIN' });
      expect(res.status).toBe(404);
      expect(db.state.teamMembers[0].role).toBe('VIEWER');
    });

    it('el estado no se puede editar a mano (un PENDING no se "activa" saltando la invitación)', async () => {
      const member = db.seedMember({ businessId: 'biz_1', email: 'p@example.com', status: 'PENDING' });
      await request(app).patch(`/api/team/members/${member.id}`).send({ status: 'ACTIVE' });
      expect(db.state.teamMembers.find((m: any) => m.id === member.id).status).toBe('PENDING');
    });

    it('rol inválido -> 400; solo ADMIN -> 403', async () => {
      const member = db.seedMember({ businessId: 'biz_1', email: 'p@example.com' });
      expect((await request(app).patch(`/api/team/members/${member.id}`).send({ role: 'ROOT' })).status).toBe(400);
      expect((await request(app).patch(`/api/team/members/${member.id}`).set('x-role', 'PROFESSIONAL').send({ role: 'ADMIN' })).status).toBe(403);
    });
  });
});
