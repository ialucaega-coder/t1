/**
 * `releaseIdempotentKey`: libera una clave reservada cuando la operación no llegó
 * a ejecutarse. Acotada por negocio + tipo + clave, y nunca lanza.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { releaseIdempotentKey } from '../../lib/idempotency';

function fakeDb(deleteMany: ReturnType<typeof vi.fn>) {
  return { connection: { deleteMany } } as unknown as Prisma.TransactionClient;
}

describe('lib/idempotency — releaseIdempotentKey', () => {
  it('borra solo la fila de ese negocio, tipo y clave', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });

    await releaseIdempotentKey(fakeDb(deleteMany), 'biz_1', 'MRGO_IDEMPOTENCY', 'conv-reply:c1:k1');

    expect(deleteMany).toHaveBeenCalledWith({
      where: { businessId: 'biz_1', type: 'MRGO_IDEMPOTENCY', config: { path: ['key'], equals: 'conv-reply:c1:k1' } },
    });
  });

  it('nunca lanza aunque la base falle', async () => {
    const deleteMany = vi.fn().mockRejectedValue(new Error('db caída'));

    await expect(releaseIdempotentKey(fakeDb(deleteMany), 'biz_1', 'T', 'k')).resolves.toBeUndefined();
  });
});
