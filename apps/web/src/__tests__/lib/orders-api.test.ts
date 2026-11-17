/** lib/api/orders: alta con Idempotency-Key y nota interna. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const post = vi.fn();
const patch = vi.fn();
vi.mock('@/lib/api/http-client', () => ({
  httpClient: { post: (...a: unknown[]) => post(...a), patch: (...a: unknown[]) => patch(...a), get: vi.fn() },
}));

import { createOrder, updateOrderNotes } from '@/lib/api/orders';

beforeEach(() => vi.clearAllMocks());

describe('lib/api/orders', () => {
  it('createOrder manda la Idempotency-Key como header cuando se la pasan', async () => {
    await createOrder({ items: [{ productId: 'p', quantity: 1 }], paymentMethod: 'CASH' }, 'k1');
    expect(post).toHaveBeenCalledWith('/orders', expect.any(Object), { 'Idempotency-Key': 'k1' });
  });

  it('createOrder sin clave no agrega headers', async () => {
    await createOrder({ items: [{ productId: 'p', quantity: 1 }], paymentMethod: 'CASH' });
    expect(post).toHaveBeenCalledWith('/orders', expect.any(Object), undefined);
  });

  it('updateOrderNotes hace PATCH a /orders/:id/notes', async () => {
    await updateOrderNotes('o1', 'hola');
    expect(patch).toHaveBeenCalledWith('/orders/o1/notes', { notes: 'hola' });
  });
});
