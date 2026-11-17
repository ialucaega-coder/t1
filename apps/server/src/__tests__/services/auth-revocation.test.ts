/**
 * Pruebas del servicio de revocación de sesiones
 * (`src/services/auth/revocation.ts`): un token emitido antes del corte
 * `validFrom` del usuario queda revocado; el posterior sigue válido. Prisma se
 * mockea; la caché en memoria es real y se limpia entre tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    connection: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

import { prisma } from '../../lib/prisma';
import { cache } from '../../lib/cache';
import { isSessionRevoked, revokeUserSessions, pruneExpired, jwtLifetimeMs } from '../../services/auth/revocation';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  cache.clear();
  // $transaction corre el callback con el mismo `prisma` mockeado.
  mock(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
  mock(prisma.$queryRaw).mockResolvedValue([]);
});

describe('services/auth/revocation', () => {
  it('sin corte (no hay fila) → el token NO está revocado', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue(null);
    const revoked = await isSessionRevoked('biz_1', 'u1', Math.floor(Date.now() / 1000));
    expect(revoked).toBe(false);
  });

  it('un token emitido ANTES del corte queda revocado; uno posterior no', async () => {
    const cutoffMs = Date.now();
    mock(prisma.connection.findFirst).mockResolvedValue({ config: { validFrom: { u1: cutoffMs } } });

    const iatAntes = Math.floor((cutoffMs - 60_000) / 1000); // 1 min antes
    expect(await isSessionRevoked('biz_1', 'u1', iatAntes)).toBe(true);

    cache.clear();
    mock(prisma.connection.findFirst).mockResolvedValue({ config: { validFrom: { u1: cutoffMs } } });
    const iatDespues = Math.floor((cutoffMs + 60_000) / 1000); // 1 min después
    expect(await isSessionRevoked('biz_1', 'u1', iatDespues)).toBe(false);
  });

  it('el corte de un usuario no afecta a otro', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue({ config: { validFrom: { u1: Date.now() } } });
    const iat = Math.floor((Date.now() - 60_000) / 1000);
    expect(await isSessionRevoked('biz_1', 'u2', iat)).toBe(false);
  });

  it('sin iat no se puede comparar → fail open (no revocado)', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue({ config: { validFrom: { u1: Date.now() } } });
    expect(await isSessionRevoked('biz_1', 'u1', undefined)).toBe(false);
  });

  it('ante error de DB → fail open (no revocado, no tumba la auth)', async () => {
    mock(prisma.connection.findFirst).mockRejectedValue(new Error('db down'));
    expect(await isSessionRevoked('biz_1', 'u1', Math.floor(Date.now() / 1000))).toBe(false);
  });

  it('revokeUserSessions crea la fila y deja el corte en la caché', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue(null);
    mock(prisma.connection.create).mockResolvedValue({ id: 'c1' });
    mock(prisma.connection.findUnique).mockResolvedValue({ config: { validFrom: {} } });
    mock(prisma.connection.update).mockResolvedValue({ id: 'c1' });

    const cutoff = Date.now();
    await revokeUserSessions('biz_9', 'u1', cutoff);

    expect(mock(prisma.connection.create)).toHaveBeenCalled();
    // La caché quedó refrescada: un token anterior al corte ya lee revocado sin ir a DB.
    const iatAntes = Math.floor((cutoff - 1000) / 1000);
    expect(await isSessionRevoked('biz_9', 'u1', iatAntes)).toBe(true);
  });

  it('revokeUserSessions toma el lock de creación ANTES de buscar la fila', async () => {
    const order: string[] = [];
    mock(prisma.$executeRaw).mockImplementation(async () => {
      order.push('lock');
      return 1;
    });
    mock(prisma.connection.findFirst).mockImplementation(async () => {
      order.push('findFirst');
      return { id: 'c1' };
    });
    mock(prisma.connection.findUnique).mockResolvedValue({ config: { validFrom: {} } });
    mock(prisma.connection.update).mockResolvedValue({ id: 'c1' });
    await revokeUserSessions('biz_lock', 'u1');
    expect(order.slice(0, 2)).toEqual(['lock', 'findFirst']);
  });

  it('revokeUserSessions poda cortes más viejos que la vida del JWT y conserva los vigentes', async () => {
    const DAY = 24 * 60 * 60 * 1000;
    mock(prisma.connection.findFirst).mockResolvedValue({ id: 'c1' });
    mock(prisma.connection.findUnique).mockResolvedValue({
      config: { validFrom: { viejo: Date.now() - 40 * DAY, reciente: Date.now() - 2 * DAY } },
    });
    mock(prisma.connection.update).mockResolvedValue({ id: 'c1' });
    await revokeUserSessions('biz_prune', 'u1');
    const saved = mock(prisma.connection.update).mock.calls[0][0] as {
      data: { config: { validFrom: Record<string, number> } };
    };
    expect(Object.keys(saved.data.config.validFrom).sort()).toEqual(['reciente', 'u1']);
  });
});

describe('services/auth/revocation — poda y vida del JWT', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();

  it('jwtLifetimeMs: default 14 d, entiende unidades y números, y ante lo desconocido no poda nunca', () => {
    expect(jwtLifetimeMs(undefined)).toBe(14 * DAY);
    expect(jwtLifetimeMs('7d')).toBe(7 * DAY);
    expect(jwtLifetimeMs('12h')).toBe(12 * 3600_000);
    expect(jwtLifetimeMs('3600')).toBe(3600_000);
    expect(jwtLifetimeMs('30 days')).toBe(Infinity);
  });

  it('pruneExpired conserva el corte vigente y descarta el inerte', () => {
    expect(pruneExpired({ a: now - 2 * DAY, b: now - 20 * DAY }, now)).toEqual({ a: now - 2 * DAY });
  });

  it('pruneExpired nunca poda al usuario que se está revocando', () => {
    expect(pruneExpired({ a: now - 90 * DAY }, now, 'a')).toEqual({ a: now - 90 * DAY });
  });

  it('con una duración de JWT desconocida no se poda nada (no revive tokens revocados)', () => {
    const prev = process.env.JWT_EXPIRES_IN;
    process.env.JWT_EXPIRES_IN = '30 days';
    try {
      expect(pruneExpired({ a: now - 400 * DAY }, now)).toEqual({ a: now - 400 * DAY });
    } finally {
      if (prev === undefined) delete process.env.JWT_EXPIRES_IN;
      else process.env.JWT_EXPIRES_IN = prev;
    }
  });
});
