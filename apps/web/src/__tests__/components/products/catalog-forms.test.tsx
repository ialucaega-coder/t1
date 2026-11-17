import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) => (isOpen ? <div>{children}</div> : null),
}));

import { ProductFormModal } from '@/components/products/ProductFormModal';
import { ServiceFormModal } from '@/components/services/ServiceFormModal';

function fillProduct(image: string, order: string) {
  fireEvent.change(screen.getByPlaceholderText('Ej: Shampoo anti-caída'), { target: { value: 'Shampoo' } });
  fireEvent.change(document.querySelector('input[step="100"]') as HTMLInputElement, { target: { value: '1500' } });
  fireEvent.change(screen.getByPlaceholderText('https://ejemplo.com/foto.jpg'), { target: { value: image } });
  fireEvent.change(screen.getByLabelText('Orden en el listado'), { target: { value: order } });
}

describe('ProductFormModal: imagen y orden', () => {
  it('envía image y sortOrder a onSave', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ProductFormModal isOpen onClose={vi.fn()} onSave={onSave} />);
    fillProduct('https://cdn.example.com/a.png', '4');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Shampoo', image: 'https://cdn.example.com/a.png', sortOrder: 4 }),
      ),
    );
  });

  it('no guarda con una imagen que no es https', async () => {
    const onSave = vi.fn();
    render(<ProductFormModal isOpen onClose={vi.fn()} onSave={onSave} />);
    fillProduct('http://inseguro.com/a.png', '0');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findAllByText('La imagen debe ser una URL https válida')).not.toHaveLength(0);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('muestra el mensaje real del server cuando falla el guardado', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('La categoría no existe'));
    render(<ProductFormModal isOpen onClose={vi.fn()} onSave={onSave} />);
    fillProduct('', '0');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('La categoría no existe')).toBeInTheDocument();
  });
});

describe('ServiceFormModal: imagen y orden', () => {
  it('envía image y sortOrder y muestra el error real del server', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Validation failed'));
    render(<ServiceFormModal isOpen onClose={vi.fn()} onSave={onSave} />);
    fireEvent.change(screen.getByPlaceholderText('Ej: Corte + Peinado'), { target: { value: 'Corte' } });
    fireEvent.change(document.querySelector('input[step="100"]') as HTMLInputElement, { target: { value: '5000' } });
    fireEvent.change(screen.getByPlaceholderText('https://ejemplo.com/foto.jpg'), { target: { value: 'https://cdn.example.com/c.jpg' } });
    fireEvent.change(screen.getByLabelText('Orden en el listado'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ image: 'https://cdn.example.com/c.jpg', sortOrder: 2 }),
      ),
    );
    expect(await screen.findByText('Validation failed')).toBeInTheDocument();
  });
});
