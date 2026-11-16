/**
 * Página de órdenes: búsqueda enviada al server, cancelación con ConfirmDialog
 * (no cancela hasta confirmar) y error real del server cuando la transición no
 * está permitida.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const getOrders = vi.fn();
const updateOrderStatus = vi.fn();
const toast = vi.fn();
vi.mock('@/lib/api/orders', () => ({
  getOrders: (...a: unknown[]) => getOrders(...a),
  updateOrderStatus: (...a: unknown[]) => updateOrderStatus(...a),
  updateOrderNotes: vi.fn(),
  createOrder: vi.fn(),
}));
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/orders/NewOrderModal', () => ({
  NewOrderModal: () => <div data-testid="new-order-modal" />,
}));

import OrdenesPage from '@/app/(dashboard)/ordenes/page';

const order = (id: string, status: string) => ({
  id, status, totalPrice: 1000, notes: null, createdAt: '2026-11-01T12:00:00Z',
  client: { id: 'c1', name: 'Ana' }, items: [{ id: 'i1', quantity: 1, price: 1000, product: { name: 'Corte' } }],
});

beforeEach(() => {
  vi.clearAllMocks();
  getOrders.mockResolvedValue({ data: [order('ord_abcdefgh12345678', 'PENDING')], total: 1, page: 1, pageSize: 20, totalPages: 1 });
});

async function openDetail() {
  render(<OrdenesPage />);
  fireEvent.click(await screen.findByText('ORD-12345678'));
}

describe('OrdenesPage', () => {
  it('manda la búsqueda al server (param search) y vuelve a la página 1', async () => {
    render(<OrdenesPage />);
    await screen.findByText('ORD-12345678');
    fireEvent.change(screen.getByLabelText('Buscar órdenes'), { target: { value: 'ORD-12345678' } });
    await waitFor(() => {
      const last = getOrders.mock.calls[getOrders.mock.calls.length - 1][0];
      expect(last).toMatchObject({ search: 'ORD-12345678', page: '1' });
    });
  });

  it('el botón Nueva orden abre el alta manual', async () => {
    render(<OrdenesPage />);
    await screen.findByText('ORD-12345678');
    fireEvent.click(screen.getByRole('button', { name: /Nueva orden/ }));
    expect(screen.getByTestId('new-order-modal')).toBeInTheDocument();
  });

  it('cancelar pide confirmación y recién al confirmar manda CANCELLED', async () => {
    updateOrderStatus.mockResolvedValue(order('ord_abcdefgh12345678', 'CANCELLED'));
    await openDetail();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(updateOrderStatus).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Sí, cancelar orden' }));
    await waitFor(() => expect(updateOrderStatus).toHaveBeenCalledWith('ord_abcdefgh12345678', 'CANCELLED'));
  });

  it('volver en el diálogo no cancela nada', async () => {
    await openDetail();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Volver' }));
    expect(updateOrderStatus).not.toHaveBeenCalled();
  });

  it('si el server rechaza la transición muestra su mensaje', async () => {
    updateOrderStatus.mockRejectedValue(new Error('No se puede pasar un pedido de DELIVERED a CANCELLED'));
    await openDetail();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sí, cancelar orden' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({ type: 'error', message: 'No se puede pasar un pedido de DELIVERED a CANCELLED' })
    );
  });
});
