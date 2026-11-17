/** /plantillas-oficiales: borrar una plantilla pide confirmación. */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { role: 'ADMIN' } }) }));

const remove = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/api/wa-templates', () => ({
  list: vi.fn().mockResolvedValue({
    templates: [
      {
        id: 't1',
        name: 'bienvenida',
        language: 'es_AR',
        category: 'UTILITY',
        status: 'DRAFT',
        body: 'Hola',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  }),
  remove: (...a: unknown[]) => remove(...a),
}));

import PlantillasOficialesPage from '@/app/(dashboard)/plantillas-oficiales/page';

describe('plantillas-oficiales: borrar', () => {
  it('no borra hasta confirmar', async () => {
    render(<PlantillasOficialesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar plantilla' }));

    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('t1'));
  });
});
