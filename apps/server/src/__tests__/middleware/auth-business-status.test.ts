/**
 * requireAuth: negocio suspendido (caché de 30 s, fail-open) y algoritmo JWT pinneado.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../../lib/prisma', () => ({
  prisma: { business: { findUnique: vi.fn() } },
}));
vi.mock('../../services/auth/revocation', () => ({
  isSessionRevoked: vi.fn(async () => false),
}));

import { prisma } from '../../lib/prisma';
import { requireAuth } from '../../middleware/auth';
import { getAuthSecret } from '../../lib/secrets';
import { isBusinessActive, invalidateBusinessActive } from '../../services/auth/businessStatus';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

const app = express();
app.get('/ping', requireAuth, (req, res) => res.json({ ok: true, businessId: req.auth!.businessId }));

const tokenFor = (businessId: string) => jwt.sign({ userId: 'u1', businessId, role: 'ADMIN' }, getAuthSecret());

beforeEach(() => {
  vi.clearAllMocks();
  for (const b of ['biz_a', 'biz_b', 'biz_c', 'biz_d']) invalidateBusinessActive(b);
});

describe('requireAuth: negocio suspendido', () => {
  it('un negocio activo pasa', async () => {
    mock(prisma.business.findUnique).mockResolvedValue({ isActive: true });
    const res = await request(app).get('/ping').set('Authorization', `Bearer ${tokenFor('biz_a')}`);
    expect(res.status).toBe(200);
    expect(prisma.business.findUnique).toHaveBeenCalledWith({ where: { id: 'biz_a' }, select: { isActive: true } });
  });

  it('un negocio suspendido recibe 403 (sin llegar a la ruta)', async () => {
    mock(prisma.business.findUnique).mockResolvedValue({ isActive: false });
    const res = await request(app).get('/ping').set('Authorization', `Bearer ${tokenFor('biz_b')}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/suspended/i);
    expect(res.body.ok).toBeUndefined();
  });

  it('cachea el estado ~30 s: varios requests hacen UNA consulta', async () => {
    mock(prisma.business.findUnique).mockResolvedValue({ isActive: true });
    const t = tokenFor('biz_c');
    await request(app).get('/ping').set('Authorization', `Bearer ${t}`);
    await request(app).get('/ping').set('Authorization', `Bearer ${t}`);
    await request(app).get('/ping').set('Authorization', `Bearer ${t}`);
    expect(prisma.business.findUnique).toHaveBeenCalledTimes(1);
  });

  it('al invalidar la caché se relee el estado (suspender / reactivar aplica ya)', async () => {
    const t = tokenFor('biz_d');
    mock(prisma.business.findUnique).mockResolvedValue({ isActive: true });
    expect((await request(app).get('/ping').set('Authorization', `Bearer ${t}`)).status).toBe(200);

    mock(prisma.business.findUnique).mockResolvedValue({ isActive: false });
    invalidateBusinessActive('biz_d');
    expect((await request(app).get('/ping').set('Authorization', `Bearer ${t}`)).status).toBe(403);

    mock(prisma.business.findUnique).mockResolvedValue({ isActive: true });
    invalidateBusinessActive('biz_d');
    expect((await request(app).get('/ping').set('Authorization', `Bearer ${t}`)).status).toBe(200);
  });

  it('fail-open: si la base falla no se bloquea a nadie (y no se cachea el error)', async () => {
    mock(prisma.business.findUnique).mockRejectedValue(new Error('db caída'));
    expect(await isBusinessActive('biz_a')).toBe(true);
    mock(prisma.business.findUnique).mockResolvedValue({ isActive: false });
    expect(await isBusinessActive('biz_a')).toBe(false);
  });

  it('un dato ausente no bloquea (solo isActive === false suspende)', async () => {
    mock(prisma.business.findUnique).mockResolvedValue(null);
    expect(await isBusinessActive('biz_b')).toBe(true);
  });
});

describe('requireAuth: algoritmo JWT pinneado a HS256', () => {
  it('rechaza (401) un token firmado con otro algoritmo HMAC (HS512) aunque use el mismo secreto', async () => {
    mock(prisma.business.findUnique).mockResolvedValue({ isActive: true });
    const hs512 = jwt.sign({ userId: 'u1', businessId: 'biz_a', role: 'ADMIN' }, getAuthSecret(), { algorithm: 'HS512' });
    const res = await request(app).get('/ping').set('Authorization', `Bearer ${hs512}`);
    expect(res.status).toBe(401);
  });

  it('rechaza un token "alg: none"', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ userId: 'u1', businessId: 'biz_a', role: 'ADMIN' })).toString('base64url');
    const res = await request(app).get('/ping').set('Authorization', `Bearer ${header}.${body}.`);
    expect(res.status).toBe(401);
  });

  it('acepta un token HS256 válido', async () => {
    mock(prisma.business.findUnique).mockResolvedValue({ isActive: true });
    const res = await request(app).get('/ping').set('Authorization', `Bearer ${tokenFor('biz_a')}`);
    expect(res.status).toBe(200);
  });
});
