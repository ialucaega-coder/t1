/**
 * Pruebas de integración de los endpoints de 2FA (`src/routes/auth.ts`):
 * setup/verify/disable/status, los códigos de recuperación y el chequeo de
 * segundo factor en el login. Prisma se mockea (con un store en memoria para la
 * tabla Connection, donde viven los códigos); otplib y el cifrado son reales.
 * Auth por JWT real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';

interface ConnRow {
  id: string;
  businessId: string;
  type: string;
  config: unknown;
}

// Store en memoria de `Connection`: lo usan los códigos de recuperación (y la
// revocación de sesiones de requireAuth, que ahí simplemente no encuentra fila).
const db = vi.hoisted(() => ({ rows: [] as ConnRow[], seq: 0 }));

vi.mock('../../lib/prisma', () => {
  const connection = {
    findFirst: vi.fn(async ({ where }: { where: { businessId: string; type: string } }) =>
      db.rows.find((r) => r.businessId === where.businessId && r.type === where.type) ?? null),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
      db.rows.find((r) => r.id === where.id) ?? null),
    create: vi.fn(async ({ data }: { data: Omit<ConnRow, 'id'> }) => {
      const row = { id: `c${++db.seq}`, ...data };
      db.rows.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: { config: unknown } }) => {
      const row = db.rows.find((r) => r.id === where.id);
      if (row) row.config = data.config;
      return row;
    }),
  };
  const prisma = {
    user: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    connection,
    $executeRaw: vi.fn(async () => 0),
    $queryRaw: vi.fn(async () => []),
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  };
  return { prisma };
});

// El límite por IP (10 por ventana) se acumularía entre los tests de este archivo.
vi.mock('../../middleware/rateLimit', () => ({
  authRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
  apiRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { prisma } from '../../lib/prisma';
import { authRouter } from '../../routes/auth';
import { encrypt } from '../../lib/crypto';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

const JWT_SECRET = process.env.NEXTAUTH_SECRET || 'dev-secret';
const token = jwt.sign({ userId: 'u1', businessId: 'biz_1', role: 'ADMIN' }, JWT_SECRET);
const auth = { Authorization: `Bearer ${token}` };

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.rows.length = 0;
  db.seq = 0;
  mock(prisma.user.update).mockResolvedValue({});
});

const RECOVERY_FORMAT = /^[2-9A-HJKMNP-TV-Z]{5}-[2-9A-HJKMNP-TV-Z]{5}$/;

/** Activa el 2FA por la ruta real y devuelve los códigos de recuperación en claro. */
async function enable2fa(app: express.Express, secret: string): Promise<string[]> {
  mock(prisma.user.findUnique).mockResolvedValue({ twoFactorSecret: encrypt(secret), twoFactorEnabled: false });
  const res = await request(app).post('/api/auth/2fa/verify').set(auth).send({ code: authenticator.generate(secret) });
  expect(res.status).toBe(200);
  return res.body.recoveryCodes as string[];
}

describe('routes/auth · 2FA', () => {
  const app = buildApp();

  describe('POST /2fa/setup', () => {
    it('genera secreto + QR y guarda el secreto cifrado sin activar', async () => {
      mock(prisma.user.findUnique).mockResolvedValue({ email: 'ana@x.com', twoFactorEnabled: false });

      const res = await request(app).post('/api/auth/2fa/setup').set(auth).send();

      expect(res.status).toBe(200);
      expect(res.body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
      expect(res.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
      const updateArg = mock(prisma.user.update).mock.calls[0][0];
      expect(updateArg.data.twoFactorEnabled).toBe(false);
      expect(typeof updateArg.data.twoFactorSecret).toBe('string');
    });

    it('rechaza (409) si 2FA ya está activo', async () => {
      mock(prisma.user.findUnique).mockResolvedValue({ email: 'ana@x.com', twoFactorEnabled: true });
      const res = await request(app).post('/api/auth/2fa/setup').set(auth).send();
      expect(res.status).toBe(409);
    });

    it('exige autenticación', async () => {
      const res = await request(app).post('/api/auth/2fa/setup').send();
      expect(res.status).toBe(401);
    });
  });

  describe('POST /2fa/verify', () => {
    it('activa 2FA con un código válido', async () => {
      const secret = authenticator.generateSecret();
      mock(prisma.user.findUnique).mockResolvedValue({ twoFactorSecret: encrypt(secret), twoFactorEnabled: false });

      const res = await request(app)
        .post('/api/auth/2fa/verify').set(auth)
        .send({ code: authenticator.generate(secret) });

      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(true);
      expect(mock(prisma.user.update).mock.calls[0][0].data).toEqual({ twoFactorEnabled: true });
    });

    it('al activar emite 10 códigos de recuperación y guarda solo sus hashes', async () => {
      const codes = await enable2fa(app, authenticator.generateSecret());

      expect(codes).toHaveLength(10);
      expect(new Set(codes).size).toBe(10);
      codes.forEach((c) => expect(c).toMatch(RECOVERY_FORMAT));

      const stored = JSON.stringify(db.rows[0].config);
      codes.forEach((c) => expect(stored).not.toContain(c.replace('-', '')));
      expect((db.rows[0].config as { codes: Record<string, string[]> }).codes.u1).toHaveLength(10);
    });

    it('rechaza un código inválido (400)', async () => {
      const secret = authenticator.generateSecret();
      mock(prisma.user.findUnique).mockResolvedValue({ twoFactorSecret: encrypt(secret), twoFactorEnabled: false });

      const res = await request(app).post('/api/auth/2fa/verify').set(auth).send({ code: '000000' });
      expect(res.status).toBe(400);
    });

    it('valida el formato del código (6 dígitos)', async () => {
      const res = await request(app).post('/api/auth/2fa/verify').set(auth).send({ code: 'abc' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /2fa/disable', () => {
    it('desactiva 2FA y borra el secreto con un código válido', async () => {
      const secret = authenticator.generateSecret();
      mock(prisma.user.findUnique).mockResolvedValue({ twoFactorSecret: encrypt(secret), twoFactorEnabled: true });

      const res = await request(app)
        .post('/api/auth/2fa/disable').set(auth)
        .send({ code: authenticator.generate(secret) });

      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(false);
      expect(mock(prisma.user.update).mock.calls[0][0].data).toEqual({ twoFactorEnabled: false, twoFactorSecret: null });
    });

    it('rechaza (400) si 2FA no está activo', async () => {
      mock(prisma.user.findUnique).mockResolvedValue({ twoFactorSecret: null, twoFactorEnabled: false });
      const res = await request(app).post('/api/auth/2fa/disable').set(auth).send({ code: '123456' });
      expect(res.status).toBe(400);
    });

    it('permite desactivar con un código de recuperación (perdió el celular) y borra los códigos', async () => {
      const secret = authenticator.generateSecret();
      const codes = await enable2fa(app, secret);
      mock(prisma.user.findUnique).mockResolvedValue({ twoFactorSecret: encrypt(secret), twoFactorEnabled: true });

      const res = await request(app).post('/api/auth/2fa/disable').set(auth).send({ code: codes[0] });

      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(false);
      expect((db.rows[0].config as { codes: Record<string, string[]> }).codes.u1).toBeUndefined();
    });
  });

  describe('GET /2fa/status y POST /2fa/recovery-codes', () => {
    it('informa cuántos códigos de recuperación quedan', async () => {
      const secret = authenticator.generateSecret();
      const codes = await enable2fa(app, secret);
      mock(prisma.user.findUnique).mockResolvedValue({ twoFactorSecret: encrypt(secret), twoFactorEnabled: true });

      const res = await request(app).get('/api/auth/2fa/status').set(auth);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ enabled: true, recoveryCodesRemaining: codes.length });
    });

    it('regenerar exige un segundo factor válido y deja inservibles los códigos viejos', async () => {
      const secret = authenticator.generateSecret();
      const oldCodes = await enable2fa(app, secret);
      mock(prisma.user.findUnique).mockResolvedValue({ twoFactorSecret: encrypt(secret), twoFactorEnabled: true });

      const bad = await request(app).post('/api/auth/2fa/recovery-codes').set(auth).send({ code: '000000' });
      expect(bad.status).toBe(400);

      const ok = await request(app).post('/api/auth/2fa/recovery-codes').set(auth).send({ code: authenticator.generate(secret) });
      expect(ok.status).toBe(200);
      expect(ok.body.recoveryCodes).toHaveLength(10);
      expect(ok.body.recoveryCodes).not.toContain(oldCodes[0]);

      // Un código del juego anterior ya no sirve como segundo factor.
      const old = await request(app).post('/api/auth/2fa/recovery-codes').set(auth).send({ code: oldCodes[1] });
      expect(old.status).toBe(400);
    });

    it('regenerar exige 2FA activo', async () => {
      mock(prisma.user.findUnique).mockResolvedValue({ twoFactorSecret: null, twoFactorEnabled: false });
      const res = await request(app).post('/api/auth/2fa/recovery-codes').set(auth).send({ code: '123456' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /login con 2FA activo', () => {
    const secret = authenticator.generateSecret();
    const baseUser = {
      id: 'u1',
      email: 'ana@x.com',
      passwordHash: '',
      isActive: true,
      deletedAt: null,
      failedLogins: 0,
      lockedUntil: null,
      businessId: 'biz_1',
      role: 'ADMIN',
      twoFactorEnabled: true,
      twoFactorSecret: encrypt(secret),
      business: { id: 'biz_1', name: 'Neg', slug: 'neg' },
    };

    beforeEach(async () => {
      baseUser.passwordHash = await bcrypt.hash('Password123', 10);
      mock(prisma.user.findUnique).mockResolvedValue({ ...baseUser });
    });

    it('pide el segundo factor cuando falta el código (sin emitir token)', async () => {
      const res = await request(app).post('/api/auth/login').send({ email: 'ana@x.com', password: 'Password123' });
      expect(res.status).toBe(200);
      expect(res.body.twoFactorRequired).toBe(true);
      expect(res.body.token).toBeUndefined();
    });

    it('rechaza (401) con un código 2FA inválido', async () => {
      const res = await request(app).post('/api/auth/login')
        .send({ email: 'ana@x.com', password: 'Password123', twoFactorCode: '000000' });
      expect(res.status).toBe(401);
    });

    it('emite token con password + código 2FA válidos', async () => {
      const res = await request(app).post('/api/auth/login')
        .send({ email: 'ana@x.com', password: 'Password123', twoFactorCode: authenticator.generate(secret) });
      expect(res.status).toBe(200);
      expect(res.body.token).toBeTruthy();
    });

    it('un código 2FA incorrecto suma un intento fallido (incremento atómico)', async () => {
      mock(prisma.user.update).mockResolvedValue({ failedLogins: 1 });
      await request(app).post('/api/auth/login')
        .send({ email: 'ana@x.com', password: 'Password123', twoFactorCode: '000000' });
      const calls = mock(prisma.user.update).mock.calls;
      expect(calls[0][0].data).toEqual({ failedLogins: { increment: 1 } });
      // Con 1 intento no hay bloqueo: no hay segunda escritura.
      expect(calls).toHaveLength(1);
    });

    it('el 5º código 2FA incorrecto bloquea la cuenta 15 minutos', async () => {
      mock(prisma.user.findUnique).mockResolvedValue({ ...baseUser, failedLogins: 4 });
      // El bloqueo se decide con el valor que DEVUELVE el incremento atómico.
      mock(prisma.user.update).mockResolvedValue({ failedLogins: 5 });
      const res = await request(app).post('/api/auth/login')
        .send({ email: 'ana@x.com', password: 'Password123', twoFactorCode: '000000' });
      expect(res.status).toBe(401);
      const calls = mock(prisma.user.update).mock.calls;
      expect(calls[0][0].data).toEqual({ failedLogins: { increment: 1 } });
      expect(calls[1][0].data.lockedUntil).toBeInstanceOf(Date);
    });

    it('un código de recuperación válido permite entrar y se gasta (un solo uso)', async () => {
      const codes = await enable2fa(app, secret);
      mock(prisma.user.findUnique).mockResolvedValue({ ...baseUser });

      const first = await request(app).post('/api/auth/login')
        .send({ email: 'ana@x.com', password: 'Password123', twoFactorCode: codes[0] });
      expect(first.status).toBe(200);
      expect(first.body.token).toBeTruthy();

      const again = await request(app).post('/api/auth/login')
        .send({ email: 'ana@x.com', password: 'Password123', twoFactorCode: codes[0] });
      expect(again.status).toBe(401);
      expect((db.rows[0].config as { codes: Record<string, string[]> }).codes.u1).toHaveLength(9);
    });

    it('acepta el código de recuperación en minúsculas y sin guion', async () => {
      const codes = await enable2fa(app, secret);
      mock(prisma.user.findUnique).mockResolvedValue({ ...baseUser });
      const res = await request(app).post('/api/auth/login')
        .send({ email: 'ana@x.com', password: 'Password123', twoFactorCode: codes[3].replace('-', '').toLowerCase() });
      expect(res.status).toBe(200);
    });

    it('un código de recuperación de OTRO usuario no sirve', async () => {
      const codes = await enable2fa(app, secret);
      mock(prisma.user.findUnique).mockResolvedValue({ ...baseUser, id: 'u2' });
      const res = await request(app).post('/api/auth/login')
        .send({ email: 'ana@x.com', password: 'Password123', twoFactorCode: codes[0] });
      expect(res.status).toBe(401);
    });
  });
});
