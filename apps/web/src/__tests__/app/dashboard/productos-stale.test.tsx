import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const toast = vi.hoisted(() => vi.fn());
const refetch = vi.hoisted(() => vi.fn());
const hook = vi.hoisted(() => ({
  updateProduct: vi.fn(),
  createProduct: vi.fn(),
  deleteProduct: vi.fn(),
}));

vi.mock('@/hooks/use-products', () => ({
  useProducts: () => ({
    products: [
      { id: 'p1', name: 'Shampoo', price: 100, stock: 10, isActive: true, updatedAt: '2026-11-15T10:00:00.000Z' },
    ],
    isLoading: false,
    error: null,
    refetch,
    createProduct: hook.createProduct,
    updateProduct: hook.updateProduct,
    deleteProduct: hook.deleteProduct,
  }),
}));
vi.mock('@/lib/api/categories', () => ({ getCategories: () => Promise.resolve([]) }));
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/categories/CategoryManagerModal', () => ({ CategoryManagerModal: () => null }));
vi.mock('@/components/products/ProductFormModal', () => ({
  ProductFormModal: ({
    isOpen,
    onSave,
    onClose,
  }: {
    isOpen: boolean;
    onSave: (d: unknown) => Promise<void>;
    onClose: () => void;
  }) =>
    isOpen ? (
      <button
        onClick={() =>
          onSave({ name: 'Shampoo', description: '', price: 100, stock: 10, categoryId: '', image: '', sortOrder: 0 })
            .then(onClose)
            .catch(() => {})
        }
      >
        guardar-mock
      </button>
    ) : null,
}));

import ProductosPage from '@/app/(dashboard)/productos/page';

const STALE = 'El producto cambió mientras lo editabas: recargá';

describe('ProductosPage: baja lógica y concurrencia', () => {
  beforeEach(() => {
    toast.mockReset();
    refetch.mockReset();
    hook.updateProduct.mockReset();
    hook.deleteProduct.mockReset();
  });

  it('al editar manda expectedUpdatedAt con el updatedAt que vio el usuario', async () => {
    hook.updateProduct.mockResolvedValue(undefined);
    render(<ProductosPage />);
    fireEvent.click(screen.getByRole('button', { name: /Editar/ }));
    fireEvent.click(screen.getByText('guardar-mock'));
    await waitFor(() => expect(hook.updateProduct).toHaveBeenCalled());
    expect(hook.updateProduct).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ stock: 10, expectedUpdatedAt: '2026-11-15T10:00:00.000Z' }),
      { throwOnError: true },
    );
  });

  it('ante un 409 recarga la lista y avisa, sin mostrar "actualizado correctamente"', async () => {
    hook.updateProduct.mockRejectedValue(new Error(STALE));
    render(<ProductosPage />);
    fireEvent.click(screen.getByRole('button', { name: /Editar/ }));
    fireEvent.click(screen.getByText('guardar-mock'));
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ type: 'error', message: STALE }));
    expect(refetch).toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('activar/desactivar también manda expectedUpdatedAt y recarga ante un 409', async () => {
    hook.updateProduct.mockRejectedValue(new Error(STALE));
    render(<ProductosPage />);
    fireEvent.click(screen.getByTitle('Desactivar'));
    await waitFor(() => expect(refetch).toHaveBeenCalled());
    expect(hook.updateProduct).toHaveBeenCalledWith(
      'p1',
      { isActive: false, expectedUpdatedAt: '2026-11-15T10:00:00.000Z' },
      { throwOnError: true },
    );
    expect(toast).toHaveBeenCalledWith({ type: 'error', message: STALE });
  });

  it('otros errores del server se muestran tal cual en el modal (sin recargar)', async () => {
    hook.updateProduct.mockRejectedValue(new Error('La categoría no existe'));
    render(<ProductosPage />);
    fireEvent.click(screen.getByRole('button', { name: /Editar/ }));
    fireEvent.click(screen.getByText('guardar-mock'));
    await waitFor(() => expect(hook.updateProduct).toHaveBeenCalled());
    expect(refetch).not.toHaveBeenCalled();
  });

  it('el diálogo de eliminar aclara que el historial de ventas se conserva y elimina', async () => {
    hook.deleteProduct.mockResolvedValue(undefined);
    render(<ProductosPage />);
    fireEvent.click(screen.getByRole('button', { name: /Eliminar/ }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('historial de ventas se conserva');
    fireEvent.click(screen.getAllByRole('button', { name: 'Eliminar' }).at(-1)!);
    await waitFor(() => expect(hook.deleteProduct).toHaveBeenCalledWith('p1', { throwOnError: true }));
  });
});
