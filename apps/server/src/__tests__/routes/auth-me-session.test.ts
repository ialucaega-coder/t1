/**
 * GET /api/auth/me y PATCH /api/auth/me deben respetar la revocación de sesiones y la
 * baja de la cuenta, igual que requireAuth: un JWT revocado (cambio de rol, quitado del
 * equipo, logout) o de una cuenta inactiva no puede seguir leyendo/editando el perfil.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../../lib/prisma', () => ({
  prisma: { user: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() } },
}));
vi.mock('../../middleware/rateLimit', () => ({
  authRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
  apiRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../../services/auth/revocation', () => ({
  revokeUserSessions: vi.fn(),
  isSessionRevoked: vi.fn(async () => false),
}));

import { prisma } from '../../lib/prisma';
import { authRouter } from '../../routes/auth';
import { getAuthSecret } from '../../lib/secrets';
import { isSessionRevoked } from '../../services/auth/revocation';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;
const token = jwt.sign({ userId: 'u1', businessId: 'biz_1', role: 'ADMIN' }, getAuthSecret());
const auth = { Authorization: `Bearer ${token}` };

const row = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  email: 'ana@x.com',
  name: 'Ana',
  role: 'ADMIN',
  isActive: true,
  deletedAt: null,
  business: { id: 'biz_1', name: 'Biz', slug: 'biz' },
  ...over,
});

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  return app;
}

describe('routes/auth · /me respeta revocación y baja', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    mock(isSessionRevoked).mockResolvedValue(false);
    mock(prisma.user.findUnique).mockResolvedValue(row());
    mock(prisma.user.update).mockResolvedValue(row());
  });

  it('GET /me con sesión vigente y cuenta activa responde 200', async () => {
    const res = await request(app).get('/api/auth/me').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe('u1');
    expect(isSessionRevoked).toHaveBeenCalledWith('biz_1', 'u1', expect.any(Number));
  });

  it('GET /me con el JWT revocado responde 401 y no consulta al usuario', async () => {
    mock(isSessionRevoked).mockResolvedValue(true);
    const res = await request(app).get('/api/auth/me').set(auth);
    expect(res.status).toBe(401);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('GET /me de una cuenta inactiva (quitada del equipo) responde 401', async () => {
    mock(prisma.user.findUnique).mockResolvedValue(row({ isActive: false }));
    const res = await request(app).get('/api/auth/me').set(auth);
    expect(res.status).toBe(401);
    expect(res.body.user).toBeUndefined();
  });

  it('GET /me de una cuenta con borrado lógico responde 401', async () => {
    mock(prisma.user.findUnique).mockResolvedValue(row({ deletedAt: new Date() }));
    expect((await request(app).get('/api/auth/me').set(auth)).status).toBe(401);
  });

  it('PATCH /me con el JWT revocado responde 401 y no modifica nada', async () => {
    mock(isSessionRevoked).mockResolvedValue(true);
    const res = await request(app).patch('/api/auth/me').set(auth).send({ name: 'Otro Nombre' });
    expect(res.status).toBe(401);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('PATCH /me de una cuenta inactiva responde 401 y no modifica nada', async () => {
    mock(prisma.user.findUnique).mockResolvedValue(row({ isActive: false }));
    const res = await request(app).patch('/api/auth/me').set(auth).send({ name: 'Otro Nombre' });
    expect(res.status).toBe(401);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('PATCH /me de una cuenta activa y vigente sigue funcionando', async () => {
    const res = await request(app).patch('/api/auth/me').set(auth).send({ name: 'Otro Nombre' });
    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalled();
  });
});
