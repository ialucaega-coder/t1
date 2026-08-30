/**
 * Pruebas de integracion para las rutas de autenticacion
 * (`src/routes/auth.ts`): registro, login, credenciales invalidas y
 * bloqueo de cuenta por intentos fallidos.
 *
 * Prisma se mockea por completo: estas pruebas no requieren una base de
 * datos real, solo verifican el comportamiento de la ruta.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import bcrypt from 'bcryptjs';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    business: {
      create: vi.fn(),
    },
  },
}));

import { prisma } from '../../lib/prisma';
import { authRouter } from '../../routes/auth';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  return app;
}

describe('routes/auth', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/auth/register', () => {
    it('crea un nuevo negocio y usuario, y devuelve un token', async () => {
      (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (prisma.business.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'biz_1',
        name: 'Mi Negocio',
        slug: 'mi-negocio-abc123',
        users: [{ id: 'user_1', email: 'nuevo@example.com', name: 'Nuevo', role: 'ADMIN' }],
      });

      const res = await request(app).post('/api/auth/register').send({
        email: 'nuevo@example.com',
        password: 'Password123',
        name: 'Nuevo',
        businessName: 'Mi Negocio',
      });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('token');
      expect(res.body.user).toMatchObject({ email: 'nuevo@example.com', role: 'ADMIN' });
      expect(res.body.business).toMatchObject({ name: 'Mi Negocio' });
    });

    it('devuelve 409 si el email ya esta registrado', async () => {
      (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'existing' });

      const res = await request(app).post('/api/auth/register').send({
        email: 'existe@example.com',
        password: 'Password123',
        name: 'Alguien',
        businessName: 'Otro Negocio',
      });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already registered/i);
    });

    it('devuelve 400 cuando el body no cumple el schema', async () => {
      const res = await request(app).post('/api/auth/register').send({
        email: 'no-es-email',
        password: '123',
        name: 'A',
        businessName: '',
      });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/auth/login', () => {
    it('devuelve 401 con credenciales invalidas (usuario inexistente)', async () => {
      (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await request(app).post('/api/auth/login').send({
        email: 'inexistente@example.com',
        password: 'cualquiera',
      });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/invalid credentials/i);
    });

    it('devuelve 401 con contrasena incorrecta e incrementa failedLogins', async () => {
      const passwordHash = await bcrypt.hash('correcta123', 12);
      (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'user_1',
        email: 'test@example.com',
        passwordHash,
        failedLogins: 0,
        lockedUntil: null,
        businessId: 'biz_1',
        role: 'ADMIN',
        business: { id: 'biz_1', name: 'Negocio', slug: 'negocio' },
      });
      (prisma.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const res = await request(app).post('/api/auth/login').send({
        email: 'test@example.com',
        password: 'incorrecta',
      });

      expect(res.status).toBe(401);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user_1' },
          data: expect.objectContaining({ failedLogins: 1 }),
        })
      );
    });

    it('bloquea la cuenta (423) tras 5 intentos fallidos', async () => {
      const passwordHash = await bcrypt.hash('correcta123', 12);
      (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'user_1',
        email: 'test@example.com',
        passwordHash,
        failedLogins: 4,
        lockedUntil: null,
        businessId: 'biz_1',
        role: 'ADMIN',
        business: { id: 'biz_1', name: 'Negocio', slug: 'negocio' },
      });
      (prisma.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const res = await request(app).post('/api/auth/login').send({
        email: 'test@example.com',
        password: 'incorrecta',
      });

      expect(res.status).toBe(401);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ failedLogins: 5, lockedUntil: expect.any(Date) }),
        })
      );
    });

    it('devuelve 423 cuando la cuenta ya esta bloqueada', async () => {
      (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'user_1',
        email: 'test@example.com',
        passwordHash: 'hash',
        failedLogins: 5,
        lockedUntil: new Date(Date.now() + 60_000),
        businessId: 'biz_1',
        role: 'ADMIN',
        business: { id: 'biz_1', name: 'Negocio', slug: 'negocio' },
      });

      const res = await request(app).post('/api/auth/login').send({
        email: 'test@example.com',
        password: 'lo-que-sea',
      });

      expect(res.status).toBe(423);
      expect(res.body.error).toMatch(/locked/i);
    });

    it('devuelve un token y resetea failedLogins con credenciales correctas', async () => {
      const passwordHash = await bcrypt.hash('correcta123', 12);
      (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'user_1',
        email: 'test@example.com',
        passwordHash,
        failedLogins: 2,
        lockedUntil: null,
        businessId: 'biz_1',
        role: 'ADMIN',
        business: { id: 'biz_1', name: 'Negocio', slug: 'negocio' },
      });
      (prisma.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const res = await request(app).post('/api/auth/login').send({
        email: 'test@example.com',
        password: 'correcta123',
      });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ failedLogins: 0, lockedUntil: null }),
        })
      );
    });
  });
});
