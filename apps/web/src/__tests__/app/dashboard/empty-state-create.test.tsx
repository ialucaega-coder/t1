import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/hooks/use-products', () => ({
  useProducts: () => ({
    products: [], isLoading: false, error: null, refetch: vi.fn(),
    createProduct: vi.fn(), updateProduct: vi.fn(), deleteProduct: vi.fn(),
  }),
}));
vi.mock('@/hooks/use-services', () => ({
  useServices: () => ({
    services: [], isLoading: false, error: null, refetch: vi.fn(),
    createService: vi.fn(), updateService: vi.fn(), deleteService: vi.fn(),
  }),
}));
vi.mock('@/lib/api/index', () => ({
  categoriesApi: { getCategories: () => Promise.resolve([]) },
}));
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/products/ProductFormModal', () => ({
  ProductFormModal: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div>modal-producto-abierto</div> : null),
}));
vi.mock('@/components/services/ServiceFormModal', () => ({
  ServiceFormModal: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div>modal-servicio-abierto</div> : null),
}));

import ProductosPage from '@/app/(dashboard)/productos/page';
import ServiciosPage from '@/app/(dashboard)/servicios/page';

describe('EmptyState: botón de crear', () => {
  it('productos: "Crear producto" abre el modal', () => {
    render(<ProductosPage />);
    expect(screen.queryByText('modal-producto-abierto')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Crear producto/i }));
    expect(screen.getByText('modal-producto-abierto')).toBeInTheDocument();
  });

  it('servicios: "Crear servicio" abre el modal', () => {
    render(<ServiciosPage />);
    expect(screen.queryByText('modal-servicio-abierto')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Crear servicio/i }));
    expect(screen.getByText('modal-servicio-abierto')).toBeInTheDocument();
  });
});
