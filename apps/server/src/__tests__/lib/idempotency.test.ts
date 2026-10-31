/**
 * Pruebas de `claimIdempotentKey` (lib/idempotency): reserva atómica de una
 * Idempotency-Key. Se usa un cliente Prisma falso que emula la transacción, el
 * advisory lock y la tabla Connection; no toca la DB real.
 */
import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { claimIdempotentKey } from '../../lib/idempotency';

interface Row {
  businessId: string;
  type: string;
  config: { key: string; entityId: string };
}

interface FindArgs {
  where: { businessId: string; type: string; config: { equals: string } };
}

function fakeClient() {
  const rows: Row[] = [];
  const executeRaw = vi.fn().mockResolvedValue(0);
  const tx = {
    $executeRaw: executeRaw,
    connection: {
      findFirst: vi.fn(
        async ({ where }: FindArgs) =>
          rows.find(
            (r) => r.businessId === where.businessId && r.type === where.type && r.config.key === where.config.equals,
          ) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Row }) => {
        rows.push(data);
        return data;
      }),
    },
  };
  const client = {
    $transaction: async (fn: (t: typeof tx) => Promise<boolean>) => fn(tx),
  } as unknown as Pick<PrismaClient, '$transaction'>;
  return { client, rows, executeRaw };
}

describe('lib/idempotency — claimIdempotentKey', () => {
  it('la primera llamada toma la clave y la persiste bajo lock', async () => {
    const { client, rows, executeRaw } = fakeClient();
    expect(await claimIdempotentKey(client, 'biz_1', 'MRGO_IDEMPOTENCY', 'run:a')).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0].config).toEqual({ key: 'run:a', entityId: 'claimed' });
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it('la misma clave en el mismo negocio devuelve false y no duplica la fila', async () => {
    const { client, rows } = fakeClient();
    await claimIdempotentKey(client, 'biz_1', 'MRGO_IDEMPOTENCY', 'run:a');
    expect(await claimIdempotentKey(client, 'biz_1', 'MRGO_IDEMPOTENCY', 'run:a')).toBe(false);
    expect(rows).toHaveLength(1);
  });

  it('la misma clave en OTRO negocio es independiente (multi-tenant)', async () => {
    const { client } = fakeClient();
    await claimIdempotentKey(client, 'biz_1', 'MRGO_IDEMPOTENCY', 'run:a');
    expect(await claimIdempotentKey(client, 'biz_2', 'MRGO_IDEMPOTENCY', 'run:a')).toBe(true);
  });
});
