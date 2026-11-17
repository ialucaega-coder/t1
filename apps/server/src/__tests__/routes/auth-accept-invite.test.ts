/**
 * POST /api/auth/accept-invite (`routes/auth.ts`): canje público de la invitación al
 * equipo. Token de un solo uso, mismas reglas de contraseña que el registro, sesión
 * devuelta como en login/registro, errores genéricos (sin enumerar usuarios) y rate
 * limit estricto por IP. Prisma en memoria (helpers/team-fake-db).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../../lib/prisma', async () => {
  const { createFakeDb } = await import('../helpers/team-fake-db');
  return { prisma: createFakeDb() };
});
vi.mock('../../lib/redis', () => ({ getRedis: () => null }));

// El limitador global de /auth (compartido con login) se neutraliza: acá se prueba el
// limitador PROPIO del canje (acceptInviteRateLimit), que sí es el real.
vi.mock('../../middleware/rateLimit', () => ({
  authRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
  apiRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../../middleware/audit', () => ({ auditAuthEvent: vi.fn(), recordAuditEvent: vi.fn() }));

vi.mock('../../lib/password', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/password')>();
  return { ...actual, hashPassword: vi.fn(actual.hashPassword) };
});

import { prisma } from '../../lib/prisma';
import type { FakeDb } from '../helpers/team-fake-db';
import { authRouter } from '../../routes/auth';
import { auditAuthEvent } from '../../middleware/audit';
import { hashPassword, verifyPassword } from '../../lib/password';
import { getAuthSecret } from '../../lib/secrets';
import { issueInviteTx } from '../../services/team/invitations';
import { cache } from '../../lib/cache';

const db = prisma as unknown as FakeDb;
const auditMock = auditAuthEvent as unknown as ReturnType<typeof vi.fn>;
const hashMock = hashPassword as unknown as ReturnType<typeof vi.fn>;

const GENERIC = 'La invitación no es válida o ya venció. Pedile a quien te invitó que te envíe una nueva.';
const GOOD_PASSWORD = 'Clave1234';
const DAY = 24 * 60 * 60 * 1000;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  return app;
}

async function invite(opts: { role?: string; email?: string; businessId?: string; now?: number } = {}) {
  const { role = 'PROFESSIONAL', email = 'nueva@example.com', businessId = 'biz_1', now } = opts;
  const member = db.seedMember({ businessId, email, role, name: 'nueva' });
  const { token } = await db.$transaction((tx: any) => issueInviteTx(tx, businessId, member.id, email, now));
  return { member, token: token as string };
}

const SAVED_ENV = { ...process.env };

describe('POST /api/auth/accept-invite', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
    db.reset();
    db.seedBusiness('biz_1', 'Peluquería Sol');
    db.seedBusiness('biz_2', 'Otro Negocio');
  });

  afterEach(() => {
    process.env = { ...SAVED_ENV };
  });

  it('token válido: crea el User con el rol del miembro, activa al miembro y devuelve la sesión como /register', async () => {
    const { member, token } = await invite({ role: 'PROFESSIONAL' });

    const res = await request(app).post('/api/auth/accept-invite').send({ token, name: 'Ana Pérez', password: GOOD_PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'nueva@example.com', name: 'Ana Pérez', role: 'PROFESSIONAL' });
    expect(res.body.business).toEqual({ id: 'biz_1', name: 'Peluquería Sol', slug: 'biz_1-slug' });

    // Mismo mecanismo de sesión: JWT {userId, businessId, role} + cookie httpOnly.
    const payload = jwt.verify(res.body.token, getAuthSecret()) as Record<string, string>;
    expect(payload).toMatchObject({ userId: res.body.user.id, businessId: 'biz_1', role: 'PROFESSIONAL' });
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/session_token=/);
    expect(cookie).toMatch(/HttpOnly/i);

    const user = db.state.users.find((u: any) => u.email === 'nueva@example.com');
    expect(user.businessId).toBe('biz_1');
    expect((await verifyPassword(GOOD_PASSWORD, user.passwordHash)).valid).toBe(true);
    expect(user.passwordHash).not.toContain(GOOD_PASSWORD);
    expect(db.state.teamMembers.find((m: any) => m.id === member.id)).toMatchObject({ status: 'ACTIVE', name: 'Ana Pérez' });

    expect(auditMock).toHaveBeenCalledWith(
      'AUTH_INVITE_ACCEPTED',
      expect.anything(),
      expect.objectContaining({ userId: user.id, businessId: 'biz_1' }),
    );
  });

  it('un miembro VIEWER entra con rol de login CLIENT (mínimo privilegio)', async () => {
    const { token } = await invite({ role: 'VIEWER' });
    const res = await request(app).post('/api/auth/accept-invite').send({ token, name: 'Ana', password: GOOD_PASSWORD });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('CLIENT');
  });

  it('el rol sale del miembro, no del request: un "role" en el body se ignora (sin fijación de rol)', async () => {
    const { token } = await invite({ role: 'VIEWER' });
    const res = await request(app)
      .post('/api/auth/accept-invite')
      .send({ token, name: 'Ana', password: GOOD_PASSWORD, role: 'ADMIN', businessId: 'biz_2', email: 'otro@example.com' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ role: 'CLIENT', email: 'nueva@example.com' });
    expect(res.body.business.id).toBe('biz_1');
  });

  it('reusar el token falla con el mensaje genérico y no crea otro usuario', async () => {
    const { token } = await invite();
    const first = await request(app).post('/api/auth/accept-invite').send({ token, name: 'Ana', password: GOOD_PASSWORD });
    expect(first.status).toBe(201);

    const second = await request(app).post('/api/auth/accept-invite').send({ token, name: 'Intruso', password: GOOD_PASSWORD });
    expect(second.status).toBe(400);
    expect(second.body).toEqual({ error: GENERIC });
    expect(db.state.users).toHaveLength(1);
  });

  it('un token vencido (más de 7 días) falla con el mensaje genérico', async () => {
    const { token } = await invite({ now: Date.now() - 8 * DAY });
    const res = await request(app).post('/api/auth/accept-invite').send({ token, name: 'Ana', password: GOOD_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: GENERIC });
    expect(db.state.users).toHaveLength(0);
  });

  it('un token de otro negocio/miembro (secreto válido con prefijo ajeno) falla', async () => {
    const { token } = await invite();
    const forged = `biz_2.${token.split('.')[1]}`;
    const res = await request(app).post('/api/auth/accept-invite').send({ token: forged, name: 'Ana', password: GOOD_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: GENERIC });
    expect(db.state.users).toHaveLength(0);
  });

  it('no enumera usuarios: token inexistente, quemado, vencido y email ya registrado dan EXACTAMENTE la misma respuesta', async () => {
    db.seedUser({ email: 'existe@example.com', businessId: 'biz_2', role: 'ADMIN' });
    const { token: conflict } = await invite({ email: 'existe@example.com' });
    const { token: expired } = await invite({ email: 'viejo@example.com', now: Date.now() - 9 * DAY });
    const { token: burned } = await invite({ email: 'usado@example.com' });
    await request(app).post('/api/auth/accept-invite').send({ token: burned, name: 'Ana', password: GOOD_PASSWORD });

    const bodies = [];
    for (const token of [conflict, expired, burned, 'biz_1.' + 'a'.repeat(43), 'basura']) {
      const res = await request(app).post('/api/auth/accept-invite').send({ token, name: 'Ana', password: GOOD_PASSWORD });
      expect(res.status).toBe(400);
      bodies.push(JSON.stringify(res.body));
    }
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toContain('no es válida');
    // La cuenta de otro negocio quedó intacta.
    expect(db.state.users.find((u: any) => u.email === 'existe@example.com')).toMatchObject({ businessId: 'biz_2', role: 'ADMIN', passwordHash: 'hash' });
  });

  it('aplica la misma política de contraseña que el registro (8+, mayúscula, minúscula, número)', async () => {
    const { token } = await invite();
    for (const password of ['corta1A', 'sinmayuscula1', 'SINMINUSCULA1', 'SinNumeroAqui', 'A1a'.repeat(50)]) {
      const res = await request(app).post('/api/auth/accept-invite').send({ token, name: 'Ana', password });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    }
    expect(db.state.users).toHaveLength(0);
    // Y el token NO se quemó por los intentos con contraseña floja.
    const ok = await request(app).post('/api/auth/accept-invite').send({ token, name: 'Ana', password: GOOD_PASSWORD });
    expect(ok.status).toBe(201);
  });

  it('pide un nombre válido', async () => {
    const { token } = await invite();
    const res = await request(app).post('/api/auth/accept-invite').send({ token, name: ' ', password: GOOD_PASSWORD });
    expect(res.status).toBe(400);
    expect(db.state.users).toHaveLength(0);
  });

  it('no gasta un hash Argon2 en tokens basura (anti-DoS por CPU en un endpoint anónimo)', async () => {
    await invite();
    await request(app).post('/api/auth/accept-invite').send({ token: 'basura', name: 'Ana', password: GOOD_PASSWORD });
    await request(app).post('/api/auth/accept-invite').send({ token: 'biz_1.' + 'a'.repeat(43), name: 'Ana', password: GOOD_PASSWORD });
    expect(hashMock).not.toHaveBeenCalled();
  });

  it('la contraseña nunca llega a la auditoría ni a la metadata', async () => {
    const { token } = await invite();
    await request(app).post('/api/auth/accept-invite').send({ token, name: 'Ana', password: GOOD_PASSWORD });
    const logged = JSON.stringify(auditMock.mock.calls.map((c) => [c[0], c[2]]));
    expect(logged).not.toContain(GOOD_PASSWORD);
    expect(logged).not.toContain(token.split('.')[1]);
  });

  it('un fallo del canje se audita como AUTH_INVITE_REJECTED', async () => {
    await request(app).post('/api/auth/accept-invite').send({ token: 'biz_1.' + 'a'.repeat(43), name: 'Ana', password: GOOD_PASSWORD });
    expect(auditMock).toHaveBeenCalledWith('AUTH_INVITE_REJECTED', expect.anything(), expect.anything());
  });

  it('rate limit estricto por IP: el 6to intento en la ventana recibe 429 (aun con token válido)', async () => {
    process.env.TENANT_RL_FORCE = 'true';
    const { token } = await invite();
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post('/api/auth/accept-invite').send({ token: 'biz_1.' + 'b'.repeat(43), name: 'Ana', password: GOOD_PASSWORD });
      expect(res.status).toBe(400);
    }
    const blocked = await request(app).post('/api/auth/accept-invite').send({ token, name: 'Ana', password: GOOD_PASSWORD });
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(db.state.users).toHaveLength(0);
  });
});
