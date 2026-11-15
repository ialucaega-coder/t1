/** /galeria: borrar un elemento pide confirmación. */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const deleteGalleryItem = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/api/gallery', () => ({
  getGallery: vi.fn().mockResolvedValue([
    { id: 'g1', url: 'https://x.com/a.jpg', tipo: 'image', titulo: 'Corte', descripcion: '', createdAt: '2026-01-01' },
  ]),
  createGalleryItem: vi.fn(),
  deleteGalleryItem: (...a: unknown[]) => deleteGalleryItem(...a),
}));

import GaleriaPage from '@/app/(dashboard)/galeria/page';

describe('galeria: borrar', () => {
  it('no borra hasta confirmar', async () => {
    render(<GaleriaPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar elemento' }));

    expect(deleteGalleryItem).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(deleteGalleryItem).toHaveBeenCalledWith('g1'));
  });
});
