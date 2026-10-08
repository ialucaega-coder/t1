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
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

import { prisma } from '../../lib/prisma';
import { cache } from '../../lib/cache';
import { isSessionRevoked, revokeUserSessions } from '../../services/auth/revocation';

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
});
