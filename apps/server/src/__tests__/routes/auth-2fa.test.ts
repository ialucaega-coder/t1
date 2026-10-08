/**
 * Pruebas de integración de los endpoints de 2FA (`src/routes/auth.ts`):
 * setup/verify/disable/status y el chequeo de segundo factor en el login.
 * Prisma se mockea; otplib y el cifrado son reales. Auth por JWT real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';

vi.mock('../../lib/prisma', () => ({
  prisma: { user: { findUnique: vi.fn(), update: vi.fn() } },
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
  mock(prisma.user.update).mockResolvedValue({});
});

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
  });
});
