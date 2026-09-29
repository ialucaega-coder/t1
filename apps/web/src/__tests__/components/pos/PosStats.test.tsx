/**
 * Pruebas de `PosStats` (`src/components/pos/PosStats.tsx`).
 * Verifica la agregación de transacciones vía UI: total de ventas, cantidad,
 * ticket promedio, clientes únicos (parseados de las notas "Cliente: X") y los
 * totales por método de pago. No se asertan las barras por hora (dependen de la
 * zona horaria local).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const get = vi.fn();
vi.mock('@/lib/api/http-client', () => ({ httpClient: { get: (...a: unknown[]) => get(...a) } }));

import { PosStats } from '@/components/pos/PosStats';

/** Lee el valor de un KPI: el valor es hermano del contenedor de la etiqueta. */
function kpi(label: string): string {
  return screen.getByText(label).parentElement?.nextElementSibling?.textContent ?? '';
}

const tx = (over: Record<string, unknown>) => ({
  id: 't', amount: 0, type: 'SALE', paymentMethod: 'CASH', reference: null,
  notes: null, createdAt: '2026-01-01T10:00:00.000Z', orderId: null, ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('components/pos/PosStats', () => {
  it('agrega KPIs y totales por método a partir de las transacciones', async () => {
    get.mockResolvedValue({
      data: [
        tx({ id: '1', amount: 1000, paymentMethod: 'CASH', notes: 'Cliente: Ana' }),
        tx({ id: '2', amount: 500, paymentMethod: 'CARD', notes: 'Cliente: Ana' }),
        tx({ id: '3', amount: 500, paymentMethod: 'CASH', notes: 'Cliente: Bob' }),
      ],
    });

    render(<PosStats />);

    await waitFor(() => expect(screen.getByText('Total ventas')).toBeInTheDocument());

    expect(kpi('Total ventas')).toBe('$2.000');
    expect(kpi('Transacciones')).toBe('3');
    expect(kpi('Ticket promedio')).toBe('$667'); // round(2000/3)
    expect(kpi('Clientes únicos')).toBe('2'); // Ana (x2) + Bob

    // Totales por método (CASH: 1000+500=1500 con 2 tx; CARD: 500 con 1 tx).
    expect(screen.getByText('Efectivo')).toBeInTheDocument();
    expect(screen.getByText('$1.500')).toBeInTheDocument();
    expect(screen.getByText('Tarjeta')).toBeInTheDocument();
    expect(screen.getByText('$500')).toBeInTheDocument();
  });

  it('muestra el estado de carga y luego el vacío cuando la API falla', async () => {
    get.mockRejectedValue(new Error('boom'));
    render(<PosStats />);

    expect(screen.getByText(/Cargando resumen/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('No hay datos para mostrar')).toBeInTheDocument());
  });
});
