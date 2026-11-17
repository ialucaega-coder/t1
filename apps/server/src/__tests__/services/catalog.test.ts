/**
 * Pruebas del servicio de catálogo (services/catalog.ts): los helpers
 * compartidos para leer el config de una feature y sembrar los defaults
 * (skills/superpoderes) de un negocio de forma incremental y race-safe.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
    skill: { findMany: vi.fn(), createMany: vi.fn() },
  },
}));

import { prisma } from '../../lib/prisma';
import { readFeatureConfig, ensureDefaultFeatures, type DefaultFeature } from '../../services/catalog';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

const DEFAULTS: DefaultFeature[] = [
  { name: 'Reservas', subtitle: 'Agenda', description: 'Gestiona turnos', iconName: 'Calendar', isActive: true },
  { name: 'Cobros', subtitle: 'Pagos', description: 'Cobra por chat', iconName: 'CreditCard', isActive: false },
];

describe('services/catalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.$executeRaw as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (cb: (tx: typeof prisma) => unknown) => cb(prisma)
    );
  });

  describe('readFeatureConfig', () => {
    it('devuelve el objeto tal cual cuando el config es un objeto', () => {
      expect(readFeatureConfig({ kind: 'skill', subtitle: 'x', iconName: 'Y' })).toEqual({
        kind: 'skill',
        subtitle: 'x',
        iconName: 'Y',
      });
    });

    it('devuelve {} para null', () => {
      expect(readFeatureConfig(null)).toEqual({});
    });

    it('devuelve {} para un array (no es un config válido)', () => {
      expect(readFeatureConfig([1, 2, 3] as unknown as never)).toEqual({});
    });

    it('devuelve {} para un valor primitivo', () => {
      expect(readFeatureConfig('nope' as unknown as never)).toEqual({});
    });
  });

  describe('ensureDefaultFeatures', () => {
    it('siembra todos los defaults cuando el negocio no tiene ninguno', async () => {
      mock(prisma.skill.findMany).mockResolvedValue([]);

      await ensureDefaultFeatures('biz_1', 'skill', DEFAULTS);

      expect(prisma.skill.createMany).toHaveBeenCalledTimes(1);
      const arg = mock(prisma.skill.createMany).mock.calls[0][0] as { data: { name: string; config: unknown }[] };
      expect(arg.data).toHaveLength(2);
      expect(arg.data[0]).toMatchObject({
        businessId: 'biz_1',
        name: 'Reservas',
        config: { kind: 'skill', subtitle: 'Agenda', iconName: 'Calendar' },
      });
    });

    it('siembra solo las features faltantes (agrega las nuevas del catálogo)', async () => {
      mock(prisma.skill.findMany).mockResolvedValue([
        { name: 'Reservas', config: { kind: 'skill' } },
      ]);

      await ensureDefaultFeatures('biz_1', 'skill', DEFAULTS);

      const arg = mock(prisma.skill.createMany).mock.calls[0][0] as { data: { name: string }[] };
      expect(arg.data).toHaveLength(1);
      expect(arg.data[0].name).toBe('Cobros');
    });

    it('no siembra nada si ya están todas (fast path, sin abrir transacción)', async () => {
      mock(prisma.skill.findMany).mockResolvedValue([
        { name: 'Reservas', config: { kind: 'skill' } },
        { name: 'Cobros', config: { kind: 'skill' } },
      ]);

      await ensureDefaultFeatures('biz_1', 'skill', DEFAULTS);

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.skill.createMany).not.toHaveBeenCalled();
    });

    it('ignora features del otro kind al calcular faltantes', async () => {
      // Existe "Reservas" pero como superpower: para kind=skill sigue faltando.
      mock(prisma.skill.findMany).mockResolvedValue([
        { name: 'Reservas', config: { kind: 'superpower' } },
      ]);

      await ensureDefaultFeatures('biz_1', 'skill', DEFAULTS);

      const arg = mock(prisma.skill.createMany).mock.calls[0][0] as { data: { name: string }[] };
      expect(arg.data.map((r) => r.name)).toEqual(['Reservas', 'Cobros']);
    });

    it('compara nombres de forma case-insensitive y sin espacios', async () => {
      mock(prisma.skill.findMany).mockResolvedValue([
        { name: '  reservas ', config: { kind: 'skill' } },
        { name: 'COBROS', config: { kind: 'skill' } },
      ]);

      await ensureDefaultFeatures('biz_1', 'skill', DEFAULTS);

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.skill.createMany).not.toHaveBeenCalled();
    });

    it('toma el advisory lock y re-chequea dentro de la transacción', async () => {
      // Fast path ve vacío; adentro del lock ya está una → solo siembra la otra.
      mock(prisma.skill.findMany)
        .mockResolvedValueOnce([]) // fast path
        .mockResolvedValueOnce([{ name: 'Reservas', config: { kind: 'skill' } }]); // dentro del lock

      await ensureDefaultFeatures('biz_1', 'skill', DEFAULTS);

      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      const arg = mock(prisma.skill.createMany).mock.calls[0][0] as { data: { name: string }[] };
      expect(arg.data).toHaveLength(1);
      expect(arg.data[0].name).toBe('Cobros');
    });

    it('no siembra si otra request concurrente ya sembró todo (re-chequeo dentro del lock)', async () => {
      mock(prisma.skill.findMany)
        .mockResolvedValueOnce([]) // fast path: faltan
        .mockResolvedValueOnce([
          { name: 'Reservas', config: { kind: 'skill' } },
          { name: 'Cobros', config: { kind: 'skill' } },
        ]); // dentro del lock: ya están todas

      await ensureDefaultFeatures('biz_1', 'skill', DEFAULTS);

      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(prisma.skill.createMany).not.toHaveBeenCalled();
    });
  });
});
