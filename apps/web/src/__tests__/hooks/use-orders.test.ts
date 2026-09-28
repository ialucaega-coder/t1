/**
 * Pruebas unitarias para el hook `useOrders` (`src/hooks/use-orders.ts`):
 * carga paginada (`data.data`), estados de loading/error, refetch y las
 * operaciones createOrder / updateOrderStatus.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/api/index', () => ({
  ordersApi: {
    getOrders: vi.fn(),
    createOrder: vi.fn(),
    updateOrderStatus: vi.fn(),
  },
}));

import { useOrders } from '@/hooks/use-orders';
import { ordersApi } from '@/lib/api/index';

const mockGetOrders = ordersApi.getOrders as ReturnType<typeof vi.fn>;
const mockCreateOrder = ordersApi.createOrder as ReturnType<typeof vi.fn>;
const mockUpdateStatus = ordersApi.updateOrderStatus as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hooks/use-orders', () => {
  it('inicia en estado de carga', () => {
    mockGetOrders.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useOrders());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.orders).toEqual([]);
  });

  it('carga los pedidos desde la propiedad data de la respuesta', async () => {
    const fakeOrders = [{ id: 'o1', status: 'PENDING' }];
    mockGetOrders.mockResolvedValue({ data: fakeOrders });

    const { result } = renderHook(() => useOrders());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.orders).toEqual(fakeOrders);
    expect(result.current.error).toBeNull();
  });

  it('pasa los parametros a la API', async () => {
    mockGetOrders.mockResolvedValue({ data: [] });

    renderHook(() => useOrders({ status: 'PAID' }));

    await waitFor(() => expect(mockGetOrders).toHaveBeenCalledWith({ status: 'PAID' }));
  });

  it('setea el error cuando la API falla', async () => {
    mockGetOrders.mockRejectedValue(new Error('Fallo de red'));

    const { result } = renderHook(() => useOrders());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Fallo de red');
    expect(result.current.orders).toEqual([]);
  });

  it('usa mensaje generico cuando el error no es instancia de Error', async () => {
    mockGetOrders.mockRejectedValue('boom');

    const { result } = renderHook(() => useOrders());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Error al cargar pedidos');
  });

  it('refetch recarga los pedidos', async () => {
    mockGetOrders.mockResolvedValue({ data: [] });

    const { result } = renderHook(() => useOrders());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockGetOrders).toHaveBeenCalledTimes(1);

    mockGetOrders.mockResolvedValue({ data: [{ id: 'x', status: 'PAID' }] });
    act(() => result.current.refetch());

    await waitFor(() => expect(result.current.orders).toEqual([{ id: 'x', status: 'PAID' }]));
    expect(mockGetOrders).toHaveBeenCalledTimes(2);
  });

  it('createOrder antepone el pedido creado a la lista', async () => {
    mockGetOrders.mockResolvedValue({ data: [{ id: 'viejo', status: 'PAID' }] });
    const created = { id: 'nuevo', status: 'PENDING' };
    mockCreateOrder.mockResolvedValue(created);

    const { result } = renderHook(() => useOrders());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let returned: unknown;
    await act(async () => {
      returned = await result.current.createOrder({} as any);
    });

    expect(returned).toEqual(created);
    expect(result.current.orders[0]).toEqual(created);
    expect(result.current.orders).toHaveLength(2);
  });

  it('createOrder devuelve null y setea error cuando falla', async () => {
    mockGetOrders.mockResolvedValue({ data: [] });
    mockCreateOrder.mockRejectedValue(new Error('Sin stock'));

    const { result } = renderHook(() => useOrders());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let returned: unknown;
    await act(async () => {
      returned = await result.current.createOrder({} as any);
    });

    expect(returned).toBeNull();
    expect(result.current.error).toBe('Sin stock');
  });

  it('updateOrderStatus reemplaza el pedido en la lista', async () => {
    mockGetOrders.mockResolvedValue({ data: [{ id: 'o1', status: 'PENDING' }] });
    mockUpdateStatus.mockResolvedValue({ id: 'o1', status: 'DELIVERED' });

    const { result } = renderHook(() => useOrders());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.updateOrderStatus('o1', 'DELIVERED');
    });

    expect(result.current.orders[0].status).toBe('DELIVERED');
  });

  it('updateOrderStatus setea error cuando falla', async () => {
    mockGetOrders.mockResolvedValue({ data: [{ id: 'o1', status: 'PENDING' }] });
    mockUpdateStatus.mockRejectedValue(new Error('No autorizado'));

    const { result } = renderHook(() => useOrders());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.updateOrderStatus('o1', 'DELIVERED');
    });

    expect(result.current.error).toBe('No autorizado');
  });
});
