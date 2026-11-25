/** /comandos: la búsqueda no distingue mayúsculas ni acentos ("Reserva" encuentra "/nueva-reserva"). */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/stores/page-counter', () => ({ usePageCounter: () => {}, fmtCounter: () => '' }));
vi.mock('@/hooks/use-commands', () => ({
  useCommands: () => ({
    commands: [
      {
        category: 'Reservas',
        items: [
          { name: '/nueva-reserva', desc: 'Crea un turno' },
          { name: '/estadisticas', desc: 'Muestra métricas del día' },
        ],
      },
    ],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

import ComandosPage from '@/app/(dashboard)/comandos/page';

describe('comandos — búsqueda', () => {
  it('encuentra por nombre aunque la búsqueda tenga mayúsculas', () => {
    render(<ComandosPage />);
    fireEvent.change(screen.getByPlaceholderText('Buscar comando...'), { target: { value: 'Reserva' } });

    expect(screen.getByText('/nueva-reserva')).toBeTruthy();
    expect(screen.queryByText('/estadisticas')).toBeNull();
  });

  it('encuentra por descripción sin importar los acentos', () => {
    render(<ComandosPage />);
    fireEvent.change(screen.getByPlaceholderText('Buscar comando...'), { target: { value: 'METRICAS' } });

    expect(screen.getByText('/estadisticas')).toBeTruthy();
  });
});
