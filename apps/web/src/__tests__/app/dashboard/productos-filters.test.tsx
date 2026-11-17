import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const toast = vi.hoisted(() => vi.fn());
const hook = vi.hoisted(() => ({
  products: [] as unknown[],
  updateProduct: vi.fn(),
  createProduct: vi.fn(),
  deleteProduct: vi.fn(),
}));

vi.mock('@/hooks/use-products', () => ({
  useProducts: () => ({
    products: hook.products, isLoading: false, error: null, refetch: vi.fn(),
    createProduct: hook.createProduct, updateProduct: hook.updateProduct, deleteProduct: hook.deleteProduct,
  }),
}));
vi.mock('@/lib/api/categories', () => ({
  getCategories: () =>
    Promise.resolve([
      { id: 'c1', name: 'Cuidado', sortOrder: 0 },
      { id: 'c2', name: 'Accesorios', sortOrder: 1 },
    ]),
}));
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/products/ProductFormModal', () => ({ ProductFormModal: () => null }));
vi.mock('@/components/categories/CategoryManagerModal', () => ({ CategoryManagerModal: () => null }));

import ProductosPage from '@/app/(dashboard)/productos/page';

const base = { price: 100, isActive: true };

function names() {
  return screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
}

describe('ProductosPage: orden, filtros y stock bajo', () => {
  beforeEach(() => {
    toast.mockReset();
    hook.updateProduct.mockReset();
    hook.products = [
      { ...base, id: 'p1', name: 'Shampoo', stock: 20, sortOrder: 2, categoryId: 'c1', category: { id: 'c1', name: 'Cuidado' } },
      { ...base, id: 'p2', name: 'Peine', stock: 3, sortOrder: 1, categoryId: 'c2', category: { id: 'c2', name: 'Accesorios' } },
      { ...base, id: 'p3', name: 'Gorra', stock: 0, sortOrder: 0 },
      { ...base, id: 'p4', name: 'Crema', stock: 6, sortOrder: 3, categoryId: 'c1', category: { id: 'c1', name: 'Cuidado' } },
    ];
  });

  it('ordena por sortOrder', async () => {
    render(<ProductosPage />);
    await screen.findByRole('option', { name: 'Cuidado' });
    expect(names()).toEqual(['Gorra', 'Peine', 'Shampoo', 'Crema']);
  });

  it('filtra por categoría y por "sin categoría"', async () => {
    render(<ProductosPage />);
    await screen.findByRole('option', { name: 'Cuidado' });
    const select = screen.getByLabelText('Filtrar por categoría');
    fireEvent.change(select, { target: { value: 'c1' } });
    expect(names()).toEqual(['Shampoo', 'Crema']);
    fireEvent.change(select, { target: { value: 'none' } });
    expect(names()).toEqual(['Gorra']);
  });

  it('el filtro "Stock bajo" muestra solo stock <= 5 y marca las tarjetas', async () => {
    render(<ProductosPage />);
    expect(screen.getByText(/2 con stock bajo/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Stock bajo/ }));
    expect(names()).toEqual(['Gorra', 'Peine']);
    expect(screen.getByText('Sin stock')).toBeInTheDocument();
    expect(screen.getAllByText('Stock bajo').length).toBeGreaterThanOrEqual(1);
  });

  it('muestra el mensaje real del server si falla activar/desactivar', async () => {
    hook.updateProduct.mockRejectedValue(new Error('Producto no encontrado'));
    render(<ProductosPage />);
    fireEvent.click(screen.getAllByTitle('Desactivar')[0]);
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ type: 'error', message: 'Producto no encontrado' }));
    expect(hook.updateProduct).toHaveBeenCalledWith(expect.any(String), expect.any(Object), { throwOnError: true });
  });
});
