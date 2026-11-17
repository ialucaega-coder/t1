/**
 * Movimientos: las tarjetas Ventas / Reembolsos / Neto deben mostrar los totales
 * REALES del server (endpoint /transactions/summary), no la suma de la página
 * cargada (25 filas).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const getTransactions = vi.fn();
const getTransactionsSummary = vi.fn();
vi.mock('@/lib/api/transactions', () => ({
  getTransactions: (...a: unknown[]) => getTransactions(...a),
  getTransactionsSummary: (...a: unknown[]) => getTransactionsSummary(...a),
  createTransaction: vi.fn(),
  exportCsv: vi.fn(),
}));
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import MovimientosPage from '@/app/(dashboard)/movimientos/page';

const row = (id: string, type: string, amount: number) => ({
  id, type, amount, paymentMethod: 'CASH', createdAt: '2026-11-01T12:00:00Z',
});

beforeEach(() => {
  vi.clearAllMocks();
  // Solo 2 filas en la página, pero el server informa que hay muchos más movimientos.
  getTransactions.mockResolvedValue({
    data: [row('1', 'SALE', 100), row('2', 'REFUND', 50)],
    total: 130, page: 1, pageSize: 25, totalPages: 6,
  });
  getTransactionsSummary.mockResolvedValue({
    sales: 98000, partial: 2000, refunds: 15000, net: 85000, count: 130,
    counts: { SALE: 100, PARTIAL: 10, REFUND: 20 },
  });
});

function card(label: string): string {
  // 'Ventas'/'Reembolsos' también son botones de filtro: tomamos el <span> de la tarjeta.
  const span = screen.getAllByText(label).find((el) => el.tagName === 'SPAN')!;
  return span.closest('div')!.parentElement!.querySelector('p')?.textContent ?? '';
}

describe('MovimientosPage: totales reales', () => {
  it('muestra los totales del server, no la suma de las filas de la página', async () => {
    render(<MovimientosPage />);
    await waitFor(() => expect(card('Ventas')).toBe('$100.000'));
    expect(card('Reembolsos')).toBe('$15.000');
    expect(card('Neto')).toBe('$85.000');
    // No es la suma de la página ($100 / $50 / $50).
    expect(card('Ventas')).not.toBe('$100');
  });

  it('pasa el filtro de tipo al resumen', async () => {
    render(<MovimientosPage />);
    await waitFor(() => expect(getTransactionsSummary).toHaveBeenCalledWith({}));
    fireEvent.click(screen.getByRole('button', { name: 'Reembolsos' }));
    await waitFor(() => expect(getTransactionsSummary).toHaveBeenLastCalledWith({ type: 'REFUND' }));
  });

  it('si el resumen falla no rompe la lista y muestra "—"', async () => {
    getTransactionsSummary.mockRejectedValue(new Error('boom'));
    render(<MovimientosPage />);
    await waitFor(() => expect(card('Neto')).toBe('—'));
    expect(screen.getByText('130 transacciones')).toBeInTheDocument();
  });
});
