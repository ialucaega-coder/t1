/**
 * Pruebas del servicio de permisos granulares del equipo
 * (`src/services/team/permissions.ts`): defaults por rol, saneo de capacidades,
 * carga/normalización de overrides y guardado atómico (crear / lock+update /
 * borrar override con array vacío).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    connection: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    subscription: { findUnique: vi.fn() },
  },
}));

import { prisma } from '../../lib/prisma';
import {
  ROLE_DEFAULTS,
  CAPABILITY_KEYS,
  resolveCapabilities,
  sanitizeCapabilities,
  normalizeRole,
  loadPermissionOverrides,
  saveMemberPermissions,
  capabilitiesForPlan,
  minTierForCapability,
  normalizePlanTier,
  loadBusinessPlanTier,
  PLAN_CAPABILITIES,
} from '../../services/team/permissions';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (cb: (tx: typeof prisma) => unknown) => cb(prisma)
  );
  (prisma.$queryRaw as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  mock(prisma.connection.update).mockResolvedValue({});
  mock(prisma.connection.create).mockResolvedValue({ id: 'conn_new' });
  mock(prisma.connection.findUnique).mockResolvedValue({ config: { overrides: {} } });
});

describe('services/team/permissions', () => {
  describe('normalizeRole', () => {
    it('acepta los enums válidos y cae a VIEWER ante lo desconocido', () => {
      expect(normalizeRole('ADMIN')).toBe('ADMIN');
      expect(normalizeRole('PROFESSIONAL')).toBe('PROFESSIONAL');
      expect(normalizeRole('cualquiera')).toBe('VIEWER');
      expect(normalizeRole(undefined)).toBe('VIEWER');
    });
  });

  describe('sanitizeCapabilities', () => {
    it('descarta claves desconocidas, deduplica y ordena canónicamente', () => {
      const result = sanitizeCapabilities(['clients', 'inexistente', 'bots', 'bots']);
      expect(result).toEqual(['bots', 'clients']);
    });

    it('devuelve [] ante entradas no-array', () => {
      expect(sanitizeCapabilities('bots')).toEqual([]);
      expect(sanitizeCapabilities(null)).toEqual([]);
    });
  });

  describe('resolveCapabilities', () => {
    it('ADMIN siempre obtiene todas las capacidades (ignora override)', () => {
      expect(resolveCapabilities('ADMIN', ['clients'])).toEqual([...CAPABILITY_KEYS]);
    });

    it('usa el default del rol cuando no hay override', () => {
      expect(resolveCapabilities('PROFESSIONAL')).toEqual(ROLE_DEFAULTS.PROFESSIONAL);
      expect(resolveCapabilities('VIEWER')).toEqual(ROLE_DEFAULTS.VIEWER);
    });

    it('usa el override saneado cuando lo hay', () => {
      expect(resolveCapabilities('PROFESSIONAL', ['clients', 'basura'])).toEqual(['clients']);
    });
  });

  describe('loadPermissionOverrides', () => {
    it('devuelve {} cuando el negocio no tiene registro', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue(null);
      expect(await loadPermissionOverrides('biz_1')).toEqual({});
    });

    it('normaliza el config: saca claves inválidas y miembros vacíos', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue({
        config: { overrides: { m1: ['bots', 'xx'], m2: ['nope'] } },
      });
      expect(await loadPermissionOverrides('biz_1')).toEqual({ m1: ['bots'] });
    });
  });

  describe('saveMemberPermissions', () => {
    it('crea el registro cuando no existe (sin lock)', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue(null);

      const result = await saveMemberPermissions('biz_1', 'm1', ['clients', 'bots'], 'PROFESSIONAL');

      expect(prisma.connection.create).toHaveBeenCalledTimes(1);
      expect(prisma.connection.update).toHaveBeenCalledTimes(1);
      expect(result).toEqual(['bots', 'clients']);
    });

    it('toma el lock y mergea cuando ya existe (no pisa a otros miembros)', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue({ id: 'conn_1' });
      mock(prisma.connection.findUnique).mockResolvedValue({ config: { overrides: { m2: ['bookings'] } } });

      await saveMemberPermissions('biz_1', 'm1', ['clients'], 'PROFESSIONAL');

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(prisma.connection.create).not.toHaveBeenCalled();
      expect(prisma.connection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'conn_1' },
          data: expect.objectContaining({ config: { overrides: { m2: ['bookings'], m1: ['clients'] } } }),
        })
      );
    });

    it('un array vacío borra el override del miembro', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue({ id: 'conn_1' });
      mock(prisma.connection.findUnique).mockResolvedValue({ config: { overrides: { m1: ['clients'], m2: ['bots'] } } });

      const result = await saveMemberPermissions('biz_1', 'm1', [], 'VIEWER');

      expect(prisma.connection.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ config: { overrides: { m2: ['bots'] } } }) })
      );
      // Vuelve al default del rol.
      expect(result).toEqual(ROLE_DEFAULTS.VIEWER);
    });

    it('ADMIN guarda su override pero resuelve a todas las capacidades', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue(null);

      const result = await saveMemberPermissions('biz_1', 'm1', ['clients'], 'ADMIN');

      expect(result).toEqual([...CAPABILITY_KEYS]);
    });
  });

  describe('planes de suscripción', () => {
    it('normalizePlanTier acepta tiers válidos y cae a FREE', () => {
      expect(normalizePlanTier('PRO')).toBe('PRO');
      expect(normalizePlanTier('loquesea')).toBe('FREE');
    });

    it('los planes son acumulativos (cada tier incluye al anterior)', () => {
      const free = new Set(PLAN_CAPABILITIES.FREE);
      const starter = new Set(PLAN_CAPABILITIES.STARTER);
      const pro = new Set(PLAN_CAPABILITIES.PRO);
      expect([...free].every((c) => starter.has(c))).toBe(true);
      expect([...starter].every((c) => pro.has(c))).toBe(true);
      // Enterprise habilita todo el catálogo.
      expect(PLAN_CAPABILITIES.ENTERPRISE).toEqual([...CAPABILITY_KEYS]);
    });

    it('capabilitiesForPlan devuelve copias (no referencia mutable)', () => {
      const caps = capabilitiesForPlan('STARTER');
      caps.push('xxx');
      expect(capabilitiesForPlan('STARTER')).not.toContain('xxx');
    });

    it('minTierForCapability da el tier mínimo que incluye la capacidad', () => {
      expect(minTierForCapability('bots')).toBe('FREE');
      expect(minTierForCapability('agency')).toBe('ENTERPRISE');
      expect(minTierForCapability('inexistente')).toBeNull();
    });

    it('loadBusinessPlanTier devuelve el tier de la suscripción activa', async () => {
      mock(prisma.subscription.findUnique).mockResolvedValue({ status: 'ACTIVE', plan: { tier: 'PRO' } });
      expect(await loadBusinessPlanTier('biz_1')).toBe('PRO');
    });

    it('loadBusinessPlanTier cae a FREE sin suscripción o si está cancelada', async () => {
      mock(prisma.subscription.findUnique).mockResolvedValue(null);
      expect(await loadBusinessPlanTier('biz_1')).toBe('FREE');

      mock(prisma.subscription.findUnique).mockResolvedValue({ status: 'CANCELLED', plan: { tier: 'PRO' } });
      expect(await loadBusinessPlanTier('biz_1')).toBe('FREE');
    });
  });
});
