/**
 * NewOrderModal: alta manual de una orden. El front manda SOLO productId +
 * cantidad (el precio lo fija el servidor), con Idempotency-Key estable, y ante
 * error muestra el mensaje real y permite reintentar sin duplicar.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const getProducts = vi.fn();
const createOrder = vi.fn();
const getClients = vi.fn();
const createClient = vi.fn();
vi.mock('@/lib/api/products', () => ({ getProducts: (...a: unknown[]) => getProducts(...a) }));
vi.mock('@/lib/api/orders', () => ({ createOrder: (...a: unknown[]) => createOrder(...a) }));
vi.mock('@/lib/api/clients', () => ({
  getClients: (...a: unknown[]) => getClients(...a),
  createClient: (...a: unknown[]) => createClient(...a),
}));

import { NewOrderModal } from '@/components/orders/NewOrderModal';

beforeAll(() => {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { ...globalThis.crypto, randomUUID: () => `id-${Math.random().toString(36).slice(2)}` },
    });
  }
});

const products = [
  { id: 'p1', name: 'Corte', price: 1000, stock: 0, isActive: true },
  { id: 'p2', name: 'Barba', price: 500, stock: 5, isActive: true },
  { id: 'p3', name: 'Discontinuado', price: 99, stock: 5, isActive: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  getProducts.mockResolvedValue(products);
  createOrder.mockResolvedValue({ id: 'ord_1' });
  getClients.mockResolvedValue({ data: [{ id: 'c1', name: 'Ana Pérez', email: 'ana@x.com', phone: '1155' }] });
  createClient.mockResolvedValue({ id: 'c_new', name: 'Beto', email: 'beto@x.com' });
});

async function setup() {
  const props = { onClose: vi.fn(), onCreated: vi.fn() };
  render(<NewOrderModal {...props} />);
  await screen.findByText('Corte');
  return props;
}

describe('NewOrderModal', () => {
  it('lista solo productos activos y no deja crear sin ítems', async () => {
    await setup();
    expect(screen.queryByText('Discontinuado')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crear orden' })).toBeDisabled();
  });

  it('envía solo productId y cantidad (nunca precios) con Idempotency-Key', async () => {
    const props = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Agregar Corte' }));
    fireEvent.click(screen.getByRole('button', { name: 'Agregar Corte' }));
    fireEvent.click(screen.getByRole('button', { name: 'Agregar Barba' }));
    expect(screen.getByText('$2.500')).toBeInTheDocument(); // total estimado

    fireEvent.click(screen.getByRole('button', { name: 'Crear orden' }));
    await waitFor(() => expect(props.onCreated).toHaveBeenCalledWith({ id: 'ord_1' }));

    const [body, key] = createOrder.mock.calls[0];
    expect(body).toEqual({
      items: [{ productId: 'p1', quantity: 2 }, { productId: 'p2', quantity: 1 }],
      paymentMethod: 'CASH',
      clientId: undefined,
      notes: undefined,
    });
    expect(JSON.stringify(body)).not.toMatch(/price|total/i);
    expect(key).toEqual(expect.any(String));
  });

  it('con cliente existente manda su clientId', async () => {
    const props = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cliente existente' }));
    fireEvent.change(screen.getByLabelText('Buscar cliente'), { target: { value: 'Ana' } });
    fireEvent.click(await screen.findByText(/Ana Pérez/));
    fireEvent.click(screen.getByRole('button', { name: 'Agregar Corte' }));
    fireEvent.click(screen.getByRole('button', { name: 'Crear orden' }));

    await waitFor(() => expect(props.onCreated).toHaveBeenCalled());
    expect(getClients).toHaveBeenCalledWith({ search: 'Ana', pageSize: 8 });
    expect(createOrder.mock.calls[0][0].clientId).toBe('c1');
  });

  it('con cliente nuevo lo crea primero y manda su id', async () => {
    const props = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cliente nuevo' }));
    fireEvent.change(screen.getByLabelText('Nombre del cliente'), { target: { value: 'Beto' } });
    fireEvent.change(screen.getByLabelText('Email del cliente'), { target: { value: 'beto@x.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar Barba' }));
    fireEvent.click(screen.getByRole('button', { name: 'Crear orden' }));

    await waitFor(() => expect(props.onCreated).toHaveBeenCalled());
    expect(createClient).toHaveBeenCalledWith({ name: 'Beto', email: 'beto@x.com', phone: undefined });
    expect(createOrder.mock.calls[0][0].clientId).toBe('c_new');
  });

  it('ante error muestra el mensaje del server, no cierra y el reintento reusa la Idempotency-Key y no recrea el cliente', async () => {
    createOrder.mockRejectedValueOnce(new Error('Stock insuficiente para Barba'));
    const props = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cliente nuevo' }));
    fireEvent.change(screen.getByLabelText('Nombre del cliente'), { target: { value: 'Beto' } });
    fireEvent.change(screen.getByLabelText('Email del cliente'), { target: { value: 'beto@x.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar Barba' }));
    fireEvent.click(screen.getByRole('button', { name: 'Crear orden' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Stock insuficiente para Barba');
    expect(props.onCreated).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Crear orden' }));
    await waitFor(() => expect(props.onCreated).toHaveBeenCalled());
    expect(createOrder).toHaveBeenCalledTimes(2);
    expect(createOrder.mock.calls[1][1]).toBe(createOrder.mock.calls[0][1]);
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createOrder.mock.calls[1][0].clientId).toBe('c_new');
  });
});
