/** TopServicesList: muestra los servicios reales de la API o un estado vacío honesto (sin ejemplos inventados). */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TopServicesList } from '@/components/stats/TopServicesList';

describe('components/stats/TopServicesList', () => {
  it('sin reservas muestra el estado vacío y NO inventa servicios ni cantidades', () => {
    render(<TopServicesList services={[]} />);

    expect(screen.getByText(/Todavía no hay reservas en este período/)).toBeInTheDocument();
    expect(screen.queryByText('Corte + Peinado')).toBeNull();
    expect(screen.queryByText('Barba')).toBeNull();
  });

  it('el estado vacío nombra el período cuando se conoce', () => {
    render(<TopServicesList services={[]} periodText="últimos 7 días" />);
    expect(screen.getByText(/en este período \(últimos 7 días\)/)).toBeInTheDocument();
  });

  it('si no llegan datos (undefined) tampoco muestra ejemplos', () => {
    render(<TopServicesList />);
    expect(screen.getByText(/Todavía no hay reservas/)).toBeInTheDocument();
  });

  it('con datos muestra nombre y cantidad reales, ordenados como vienen', () => {
    render(
      <TopServicesList
        services={[
          { id: 's1', name: 'Corte', bookingCount: 12 },
          { id: 's2', name: 'Color', bookingCount: 3 },
        ]}
      />,
    );
    expect(screen.getByText('Corte')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.queryByText(/Todavía no hay reservas/)).toBeNull();
  });
});
