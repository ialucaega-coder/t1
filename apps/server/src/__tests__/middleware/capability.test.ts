/**
 * Pruebas del middleware requireCapability (`src/middleware/capability.ts`):
 * 401 sin auth, 403 cuando la capacidad no está en (rol ∩ plan), next() cuando sí.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

// Para los tests de rol ADMIN mockeamos el servicio entero (resolveCapabilities
// controlado). Para el camino de override usamos la implementación real de
// resolveCapabilities, por eso importamos el módulo real dentro de esos tests.
vi.mock('../../services/team/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/team/permissions')>();
  return {
    ...actual,
    loadBusinessPlanTier: vi.fn(),
    capabilitiesForPlan: vi.fn(),
    resolveCapabilities: vi.fn(),
    loadPermissionOverrides: vi.fn(),
  };
});

vi.mock('../../lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    teamMember: { findFirst: vi.fn() },
  },
}));

import {
  loadBusinessPlanTier,
  capabilitiesForPlan,
  resolveCapabilities,
  loadPermissionOverrides,
} from '../../services/team/permissions';
import { prisma } from '../../lib/prisma';
import { requireCapability } from '../../middleware/capability';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function buildApp(withAuth: boolean, capability: string, role: 'ADMIN' | 'PROFESSIONAL' | 'CLIENT' = 'ADMIN') {
  const app = express();
  if (withAuth) {
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.auth = { userId: 'u1', businessId: 'biz_1', role };
      next();
    });
  }
  app.get('/x', requireCapability(capability), (_req, res) => res.json({ ok: true }));
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mock(loadBusinessPlanTier).mockResolvedValue('PRO');
  mock(loadPermissionOverrides).mockResolvedValue({});
});

describe('middleware/requireCapability', () => {
  it('401 si no hay auth', async () => {
    const res = await request(buildApp(false, 'agency')).get('/x');
    expect(res.status).toBe(401);
  });

  it('403 si la capacidad no está en el plan (rol la tiene pero el plan no)', async () => {
    mock(resolveCapabilities).mockReturnValue(['agency', 'bots']);
    mock(capabilitiesForPlan).mockReturnValue(['bots']); // plan NO incluye agency
    const res = await request(buildApp(true, 'agency')).get('/x');
    expect(res.status).toBe(403);
    expect(res.body.capability).toBe('agency');
  });

  it('403 si el rol no tiene la capacidad (aunque el plan la incluya)', async () => {
    mock(resolveCapabilities).mockReturnValue(['bots']); // rol NO incluye agency
    mock(capabilitiesForPlan).mockReturnValue(['agency', 'bots']);
    const res = await request(buildApp(true, 'agency')).get('/x');
    expect(res.status).toBe(403);
  });

  it('deja pasar cuando la capacidad está en rol ∩ plan', async () => {
    mock(resolveCapabilities).mockReturnValue(['agency', 'bots']);
    mock(capabilitiesForPlan).mockReturnValue(['agency', 'bots']);
    const res = await request(buildApp(true, 'agency')).get('/x');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  // --- Overrides por miembro (el aporte nuevo: el backend ahora los aplica) ---

  it('un override por miembro CONCEDE una capacidad que el rol no tenía por defecto', async () => {
    // VIEWER por defecto no tiene 'clients'; el admin se lo concede por override.
    mock(resolveCapabilities).mockImplementation(((role: unknown, override?: string[]) =>
      override && override.length ? override : ['conversations']) as never);
    mock(capabilitiesForPlan).mockReturnValue(['clients', 'conversations', 'bots']);
    mock(loadPermissionOverrides).mockResolvedValue({ tm1: ['clients'] });
    mock(prisma.user.findUnique).mockResolvedValue({ email: 'viewer@x.com' });
    mock(prisma.teamMember.findFirst).mockResolvedValue({ id: 'tm1' });

    const res = await request(buildApp(true, 'clients', 'PROFESSIONAL')).get('/x');
    expect(res.status).toBe(200);
    // Se vinculó User→TeamMember por email y se aplicó el override.
    expect(mock(prisma.teamMember.findFirst)).toHaveBeenCalled();
  });

  it('sin override, cae al default del rol (y 403 si no alcanza)', async () => {
    mock(resolveCapabilities).mockImplementation(((role: unknown, override?: string[]) =>
      override && override.length ? override : ['conversations']) as never);
    mock(capabilitiesForPlan).mockReturnValue(['clients', 'conversations']);
    mock(loadPermissionOverrides).mockResolvedValue({}); // sin overrides

    const res = await request(buildApp(true, 'clients', 'PROFESSIONAL')).get('/x');
    expect(res.status).toBe(403);
  });

  it('ADMIN no carga overrides (nunca se capa)', async () => {
    mock(resolveCapabilities).mockReturnValue(['agency', 'bots', 'clients']);
    mock(capabilitiesForPlan).mockReturnValue(['agency', 'bots', 'clients']);
    const res = await request(buildApp(true, 'clients', 'ADMIN')).get('/x');
    expect(res.status).toBe(200);
    expect(mock(loadPermissionOverrides)).not.toHaveBeenCalled();
  });
});
