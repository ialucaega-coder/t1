/** OrderNotes: nota interna editable del pedido. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const updateOrderNotes = vi.fn();
vi.mock('@/lib/api/orders', () => ({ updateOrderNotes: (...a: unknown[]) => updateOrderNotes(...a) }));

import { OrderNotes } from '@/components/orders/OrderNotes';
import type { Order } from '@/types';

const order = { id: 'o1', status: 'PENDING', totalPrice: 10, notes: 'Vieja', createdAt: '', client: { id: 'c', name: 'Ana' }, items: [] } as Order;

beforeEach(() => vi.clearAllMocks());

describe('OrderNotes', () => {
  it('muestra la nota actual y deshabilita Guardar hasta que haya cambios', () => {
    render(<OrderNotes order={order} onSaved={vi.fn()} />);
    expect(screen.getByLabelText('Nota interna')).toHaveValue('Vieja');
    expect(screen.getByRole('button', { name: 'Guardar nota' })).toBeDisabled();
  });

  it('guarda la nota editada y avisa con el pedido actualizado', async () => {
    const saved = { ...order, notes: 'Nueva' };
    updateOrderNotes.mockResolvedValue(saved);
    const onSaved = vi.fn();
    render(<OrderNotes order={order} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText('Nota interna'), { target: { value: 'Nueva' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nota' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    expect(updateOrderNotes).toHaveBeenCalledWith('o1', 'Nueva');
  });

  it('muestra el error si falla el guardado y no avisa de éxito', async () => {
    updateOrderNotes.mockRejectedValue(new Error('La nota no puede superar los 2000 caracteres'));
    const onSaved = vi.fn();
    render(<OrderNotes order={order} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText('Nota interna'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nota' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('2000 caracteres');
    expect(onSaved).not.toHaveBeenCalled();
  });
});
