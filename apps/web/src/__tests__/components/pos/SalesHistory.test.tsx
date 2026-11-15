/**
 * SalesHistory: el filtro por método de pago (CASH/CARD/...) debe viajar como
 * `paymentMethod`, no como `type` (que el server usa para SALE/REFUND/PARTIAL).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const get = vi.fn();
vi.mock('@/lib/api/http-client', () => ({ httpClient: { get: (...a: unknown[]) => get(...a) } }));

import { SalesHistory } from '@/components/pos/SalesHistory';

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ data: [], totalPages: 1 });
});

describe('components/pos/SalesHistory', () => {
  it('filtra por método usando el query param paymentMethod (no type)', async () => {
    render(<SalesHistory />);
    await waitFor(() => expect(get).toHaveBeenCalled());

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'CARD' } });

    await waitFor(() => {
      const url = get.mock.calls[get.mock.calls.length - 1][0] as string;
      const qs = new URLSearchParams(url.split('?')[1]);
      expect(qs.get('paymentMethod')).toBe('CARD');
      expect(qs.has('type')).toBe(false);
    });
  });
});
