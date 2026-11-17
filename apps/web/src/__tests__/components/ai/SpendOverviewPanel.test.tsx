/** SpendOverviewPanel: tabla por negocio, orden, estados y reintento. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

const getSpendOverview = vi.fn();
vi.mock('@/lib/api/ai', () => ({
  getSpendOverview: (...a: unknown[]) => getSpendOverview(...a),
}));

import { SpendOverviewPanel } from '@/components/ai/SpendOverviewPanel';

const rows = [
  { businessId: 'a', name: 'Alfa', spentUsd: 50, capUsd: null, ratio: null, level: 'ok' },
  { businessId: 'b', name: 'Beta', spentUsd: 9, capUsd: 10, ratio: 0.9, level: 'warn' },
  { businessId: 'c', name: 'Gamma', spentUsd: 12, capUsd: 10, ratio: 1.2, level: 'blocked' },
  { businessId: 'd', name: 'Delta', spentUsd: 1, capUsd: 100, ratio: 0.01, level: 'ok' },
];

const names = () =>
  within(screen.getByRole('table'))
    .getAllByRole('row')
    .slice(1)
    .map((r) => within(r).getAllByRole('cell')[0].textContent);

beforeEach(() => {
  getSpendOverview.mockReset();
});

describe('SpendOverviewPanel', () => {
  it('muestra una fila por negocio con su estado en texto', async () => {
    getSpendOverview.mockResolvedValue({ month: '2026-11', totalUsd: 72, businesses: rows });
    render(<SpendOverviewPanel />);

    await screen.findByRole('table');
    expect(screen.getByText('Sin tope')).toBeInTheDocument();
    expect(screen.getByText(/Cerca del tope/)).toBeInTheDocument();
    expect(screen.getByText(/Tope alcanzado/)).toBeInTheDocument();
    expect(screen.getByText('Normal')).toBeInTheDocument();
    // Sin tope: tope y % usado en blanco (no se inventa un 0 %).
    const alfa = screen.getByText('Alfa').closest('tr') as HTMLElement;
    const cells = within(alfa).getAllByRole('cell').map((c) => c.textContent);
    expect(cells.slice(2, 4)).toEqual(['—', '—']);
    expect(screen.getByText(/precios son aproximados/i)).toBeInTheDocument();
  });

  it('ordena por % usado por defecto (sin tope al final) y por gasto al cambiar', async () => {
    getSpendOverview.mockResolvedValue({ month: '2026-11', totalUsd: 72, businesses: rows });
    render(<SpendOverviewPanel />);

    await screen.findByRole('table');
    expect(names()).toEqual(['Gamma', 'Beta', 'Delta', 'Alfa']);

    fireEvent.change(screen.getByLabelText('Ordenar por'), { target: { value: 'spent' } });
    expect(names()).toEqual(['Alfa', 'Gamma', 'Beta', 'Delta']);
  });

  it('tolera varios negocios con ratio null: van al final, ordenados por gasto', async () => {
    getSpendOverview.mockResolvedValue({
      month: '2026-11',
      totalUsd: 0,
      businesses: [
        { businessId: 'x', name: 'SinTopeChico', spentUsd: 1, capUsd: null, ratio: null, level: 'ok' },
        { businessId: 'y', name: 'ConTope', spentUsd: 1, capUsd: 100, ratio: 0.01, level: 'ok' },
        { businessId: 'z', name: 'SinTopeGrande', spentUsd: 80, capUsd: null, ratio: null, level: 'ok' },
      ],
    });
    render(<SpendOverviewPanel />);

    await screen.findByRole('table');
    expect(names()).toEqual(['ConTope', 'SinTopeGrande', 'SinTopeChico']);
  });

  it('muestra estado vacío', async () => {
    getSpendOverview.mockResolvedValue({ month: '2026-11', totalUsd: 0, businesses: [] });
    render(<SpendOverviewPanel />);
    expect(await screen.findByText(/Todavía no hay gasto de IA/)).toBeInTheDocument();
  });

  it('ante un error muestra el mensaje y permite reintentar', async () => {
    getSpendOverview.mockRejectedValueOnce(new Error('Falló')).mockResolvedValueOnce({
      month: '2026-11',
      totalUsd: 1,
      businesses: [rows[3]],
    });
    render(<SpendOverviewPanel />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Falló');
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(getSpendOverview).toHaveBeenCalledTimes(2);
  });
});
