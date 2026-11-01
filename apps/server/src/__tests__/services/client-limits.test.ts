/**
 * Topes y poda de los mapas por cliente (CRM / lifecycle) y lock de creación de
 * las filas singleton de `Connection`. Prisma mockeado.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    connection: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    user: { findMany: vi.fn() },
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(),
  },
}));

import { prisma } from '../../lib/prisma';
import { AppError } from '../../middleware/errorHandler';
import { enforceClientMapLimit, activeClientIds } from '../../services/clients/limits';
import { setClientStage } from '../../services/clients/lifecycle';
import { lockSingleton, singletonLockKey } from '../../lib/singletonLock';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mock(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
  mock(prisma.$queryRaw).mockResolvedValue([]);
  mock(prisma.$executeRaw).mockResolvedValue(1);
});

describe('services/clients/limits', () => {
  it('bajo el tope devuelve el mapa tal cual y no consulta clientes', async () => {
    const map = { a: 1, b: 2 };
    const out = await enforceClientMapLimit(prisma as never, 'biz', map, 5, 'a', 'x');
    expect(out).toBe(map);
    expect(mock(prisma.user.findMany)).not.toHaveBeenCalled();
  });

  it('sobre el tope poda huérfanos y deja pasar si entra', async () => {
    mock(prisma.user.findMany).mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    const out = await enforceClientMapLimit(prisma as never, 'biz', { a: 1, b: 2, c: 3 }, 2, 'zzz', 'x');
    expect(out).toEqual({ a: 1, b: 2 });
  });

  it('el cliente que se está guardando nunca se poda', async () => {
    mock(prisma.user.findMany).mockResolvedValue([{ id: 'a' }]);
    // 'nuevo' no figura entre los activos (p. ej. recién creado y aún no visible): se conserva igual.
    const out = await enforceClientMapLimit(prisma as never, 'biz', { a: 1, huerfano: 2, nuevo: 9 }, 2, 'nuevo', 'x');
    expect(Object.keys(out).sort()).toEqual(['a', 'nuevo']);
  });

  it('si aun podando no entra, rechaza con un 409 claro', async () => {
    mock(prisma.user.findMany).mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const attempt = enforceClientMapLimit(prisma as never, 'biz', { a: 1, b: 2, c: 3 }, 2, 'a', 'etapa');
    await expect(attempt).rejects.toBeInstanceOf(AppError);
    await expect(attempt).rejects.toMatchObject({ statusCode: 409 });
  });

  it('activeClientIds consulta en tandas y siempre acota por negocio', async () => {
    mock(prisma.user.findMany).mockResolvedValue([]);
    const ids = Array.from({ length: 4500 }, (_, i) => `c${i}`);
    await activeClientIds(prisma as never, 'biz_1', ids);
    expect(mock(prisma.user.findMany)).toHaveBeenCalledTimes(3);
    const where = (mock(prisma.user.findMany).mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where).toMatchObject({ businessId: 'biz_1', role: 'CLIENT', deletedAt: null });
  });
});

describe('lifecycle — tope al sumar entradas', () => {
  it('cambiar la etapa de un cliente que ya está en el mapa no consulta clientes', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue({ id: 'c1' });
    mock(prisma.connection.findUnique).mockResolvedValue({ config: { stages: { u1: 'HOT' } } });
    mock(prisma.connection.update).mockResolvedValue({ id: 'c1' });
    await setClientStage('biz', 'u1', 'PAYMENT');
    expect(mock(prisma.user.findMany)).not.toHaveBeenCalled();
    expect(mock(prisma.connection.update)).toHaveBeenCalled();
  });
});

describe('lib/singletonLock', () => {
  it('toma un advisory lock transaccional con clave (negocio, type)', async () => {
    await lockSingleton(prisma as never, 'biz_1', 'CLIENT_CRM');
    expect(mock(prisma.$executeRaw)).toHaveBeenCalledTimes(1);
    expect(singletonLockKey('biz_1', 'CLIENT_CRM')).toBe('conn-singleton:CLIENT_CRM:biz_1');
    expect(singletonLockKey('biz_2', 'CLIENT_CRM')).not.toBe(singletonLockKey('biz_1', 'CLIENT_CRM'));
  });

  it('las escrituras del lifecycle toman el lock antes de buscar la fila', async () => {
    const order: string[] = [];
    mock(prisma.$executeRaw).mockImplementation(async () => {
      order.push('lock');
      return 1;
    });
    mock(prisma.connection.findFirst).mockImplementation(async () => {
      order.push('findFirst');
      return null;
    });
    mock(prisma.connection.create).mockResolvedValue({ id: 'c1' });
    await setClientStage('biz', 'u1', 'HOT');
    expect(order.slice(0, 2)).toEqual(['lock', 'findFirst']);
  });
});
