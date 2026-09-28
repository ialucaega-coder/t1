/**
 * Pruebas unitarias para el hook `useProducts` (`src/hooks/use-products.ts`):
 * carga, error, refetch y las operaciones create/update/delete.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/api/index', () => ({
  productsApi: {
    getProducts: vi.fn(),
    createProduct: vi.fn(),
    updateProduct: vi.fn(),
    deleteProduct: vi.fn(),
  },
}));

import { useProducts } from '@/hooks/use-products';
import { productsApi } from '@/lib/api/index';

const mockGet = productsApi.getProducts as ReturnType<typeof vi.fn>;
const mockCreate = productsApi.createProduct as ReturnType<typeof vi.fn>;
const mockUpdate = productsApi.updateProduct as ReturnType<typeof vi.fn>;
const mockDelete = productsApi.deleteProduct as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hooks/use-products', () => {
  it('inicia en estado de carga', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useProducts());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.products).toEqual([]);
  });

  it('carga los productos desde la API', async () => {
    const fake = [{ id: 'p1', name: 'Shampoo' }];
    mockGet.mockResolvedValue(fake);

    const { result } = renderHook(() => useProducts());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.products).toEqual(fake);
    expect(result.current.error).toBeNull();
  });

  it('setea error cuando la carga falla', async () => {
    mockGet.mockRejectedValue(new Error('Timeout'));

    const { result } = renderHook(() => useProducts());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Timeout');
  });

  it('usa mensaje generico cuando el error no es Error', async () => {
    mockGet.mockRejectedValue(123);

    const { result } = renderHook(() => useProducts());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Error al cargar productos');
  });

  it('createProduct agrega el producto al final de la lista', async () => {
    mockGet.mockResolvedValue([{ id: 'p1', name: 'Shampoo' }]);
    const created = { id: 'p2', name: 'Acondicionador' };
    mockCreate.mockResolvedValue(created);

    const { result } = renderHook(() => useProducts());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let returned: unknown;
    await act(async () => {
      returned = await result.current.createProduct({ name: 'Acondicionador' });
    });

    expect(returned).toEqual(created);
    expect(result.current.products.at(-1)).toEqual(created);
    expect(result.current.products).toHaveLength(2);
  });

  it('createProduct devuelve null y setea error cuando falla', async () => {
    mockGet.mockResolvedValue([]);
    mockCreate.mockRejectedValue(new Error('Nombre duplicado'));

    const { result } = renderHook(() => useProducts());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let returned: unknown;
    await act(async () => {
      returned = await result.current.createProduct({ name: 'x' });
    });

    expect(returned).toBeNull();
    expect(result.current.error).toBe('Nombre duplicado');
  });

  it('updateProduct reemplaza el producto por id', async () => {
    mockGet.mockResolvedValue([{ id: 'p1', name: 'Shampoo' }]);
    mockUpdate.mockResolvedValue({ id: 'p1', name: 'Shampoo Pro' });

    const { result } = renderHook(() => useProducts());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.updateProduct('p1', { name: 'Shampoo Pro' });
    });

    expect(result.current.products[0].name).toBe('Shampoo Pro');
  });

  it('updateProduct setea error cuando falla', async () => {
    mockGet.mockResolvedValue([{ id: 'p1', name: 'Shampoo' }]);
    mockUpdate.mockRejectedValue(new Error('No encontrado'));

    const { result } = renderHook(() => useProducts());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.updateProduct('p1', { name: 'x' });
    });

    expect(result.current.error).toBe('No encontrado');
  });

  it('deleteProduct elimina el producto de la lista', async () => {
    mockGet.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);
    mockDelete.mockResolvedValue(undefined);

    const { result } = renderHook(() => useProducts());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.deleteProduct('p1');
    });

    expect(result.current.products).toEqual([{ id: 'p2' }]);
  });

  it('deleteProduct setea error cuando falla', async () => {
    mockGet.mockResolvedValue([{ id: 'p1' }]);
    mockDelete.mockRejectedValue(new Error('En uso'));

    const { result } = renderHook(() => useProducts());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.deleteProduct('p1');
    });

    expect(result.current.error).toBe('En uso');
    expect(result.current.products).toHaveLength(1);
  });
});
