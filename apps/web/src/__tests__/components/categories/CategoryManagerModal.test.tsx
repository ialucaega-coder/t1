import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
  getCategories: vi.fn(),
}));
vi.mock('@/lib/api/categories', () => api);
vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) => (isOpen ? <div>{children}</div> : null),
}));

import { CategoryManagerModal } from '@/components/categories/CategoryManagerModal';

const categories = [
  { id: 'c1', name: 'Cuidado', sortOrder: 0, _count: { products: 3, services: 1 } },
  { id: 'c2', name: 'Vacía', sortOrder: 1, _count: { products: 0, services: 0 } },
];

function setup() {
  const onChanged = vi.fn();
  render(<CategoryManagerModal isOpen onClose={vi.fn()} categories={categories} onChanged={onChanged} />);
  return { onChanged };
}

describe('CategoryManagerModal', () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
  });

  it('crea una categoría y avisa para recargar', async () => {
    api.createCategory.mockResolvedValue({ id: 'c3', name: 'Nueva' });
    const { onChanged } = setup();
    fireEvent.change(screen.getByLabelText('Nombre de la nueva categoría'), { target: { value: '  Nueva ' } });
    fireEvent.click(screen.getByRole('button', { name: /Agregar/ }));
    await waitFor(() => expect(api.createCategory).toHaveBeenCalledWith({ name: 'Nueva' }));
    expect(onChanged).toHaveBeenCalled();
  });

  it('muestra el mensaje real del server si el nombre está duplicado', async () => {
    api.createCategory.mockRejectedValue(new Error('Ya existe una categoría con ese nombre'));
    const { onChanged } = setup();
    fireEvent.change(screen.getByLabelText('Nombre de la nueva categoría'), { target: { value: 'Cuidado' } });
    fireEvent.click(screen.getByRole('button', { name: /Agregar/ }));
    expect(await screen.findByText('Ya existe una categoría con ese nombre')).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('renombra una categoría', async () => {
    api.updateCategory.mockResolvedValue({});
    const { onChanged } = setup();
    fireEvent.click(screen.getByTitle('Renombrar Cuidado'));
    fireEvent.change(screen.getByLabelText('Nuevo nombre para Cuidado'), { target: { value: 'Cuidado capilar' } });
    fireEvent.click(screen.getByTitle('Guardar nombre'));
    await waitFor(() => expect(api.updateCategory).toHaveBeenCalledWith('c1', { name: 'Cuidado capilar' }));
    expect(onChanged).toHaveBeenCalled();
  });

  it('eliminar una categoría vacía pide confirmación y no usa detach', async () => {
    api.deleteCategory.mockResolvedValue(null);
    const { onChanged } = setup();
    fireEvent.click(screen.getByTitle('Eliminar Vacía'));
    expect(api.deleteCategory).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toHaveTextContent('¿Eliminar la categoría "Vacía"?');
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(api.deleteCategory).toHaveBeenCalledWith('c2', { detach: false }));
    expect(onChanged).toHaveBeenCalled();
  });

  it('una categoría con items advierte que quedan sin categoría y recién ahí usa detach', async () => {
    api.deleteCategory.mockResolvedValue(null);
    setup();
    fireEvent.click(screen.getByTitle('Eliminar Cuidado'));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('3 productos · 1 servicio');
    expect(screen.getByRole('alertdialog')).toHaveTextContent('quedar sin categoría');
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar y dejar sin categoría' }));
    await waitFor(() => expect(api.deleteCategory).toHaveBeenCalledWith('c1', { detach: true }));
  });

  it('cancelar la confirmación no elimina nada', () => {
    setup();
    fireEvent.click(screen.getByTitle('Eliminar Cuidado'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(api.deleteCategory).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('muestra el error real del server si falla el borrado', async () => {
    api.deleteCategory.mockRejectedValue(new Error('La categoría tiene 1 producto'));
    setup();
    fireEvent.click(screen.getByTitle('Eliminar Vacía'));
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
    expect(await screen.findByText('La categoría tiene 1 producto')).toBeInTheDocument();
  });
});
