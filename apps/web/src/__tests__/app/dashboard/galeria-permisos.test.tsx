import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const auth = vi.hoisted(() => ({ role: 'ADMIN' }));

vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { role: auth.role } }) }));
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/api/gallery', () => ({
  getGallery: vi.fn().mockResolvedValue([
    { id: 'g1', url: 'https://x.com/a.jpg', tipo: 'image', titulo: 'Foto', descripcion: '' },
  ]),
  createGalleryItem: vi.fn(),
  deleteGalleryItem: vi.fn(),
}));

import GaleriaPage from '@/app/(dashboard)/galeria/page';

describe('GaleriaPage: permisos', () => {
  beforeEach(() => {
    auth.role = 'ADMIN';
  });

  it('el ADMIN ve "Agregar elemento" y "Eliminar"', async () => {
    render(<GaleriaPage />);
    expect(await screen.findByRole('button', { name: /Agregar elemento/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Eliminar elemento')).toBeInTheDocument();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('un no-ADMIN no ve "Agregar" ni "Eliminar" y recibe la explicación', async () => {
    auth.role = 'PROFESSIONAL';
    render(<GaleriaPage />);
    expect(await screen.findByText('Foto')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Agregar elemento/ })).toBeNull();
    expect(screen.queryByLabelText('Eliminar elemento')).toBeNull();
    expect(screen.getByRole('note')).toHaveTextContent('Solo un administrador puede agregar o eliminar');
  });
});
