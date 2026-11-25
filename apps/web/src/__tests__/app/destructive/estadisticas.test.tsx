/** /estadisticas: la tarjeta Clientes no debe mostrar la variación de reservas. */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/hooks/use-stats', () => ({
  useStats: () => ({
    overview: {
      totalClients: 10,
      monthBookings: 5,
      bookingChange: '+99.9%',
      revenue: 1000,
      revenueChange: '+7.5%',
      noShowRate: '3%',
      noShowChange: '-1%',
    },
    weeklyData: [],
    topServices: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/components/stats/WeeklyChart', () => ({ WeeklyChart: () => null }));
vi.mock('@/components/stats/TopServicesList', () => ({ TopServicesList: () => null }));
vi.mock('@/components/stats/HealthIndicators', () => ({ HealthIndicators: () => null }));

import EstadisticasPage from '@/app/(dashboard)/estadisticas/page';

describe('estadisticas: tarjeta Clientes', () => {
  it('no reutiliza la variación de reservas; solo aparece en la tarjeta Reservas', () => {
    render(<EstadisticasPage />);

    // La variación de reservas se muestra una sola vez (en Reservas), no también en Clientes.
    expect(screen.getAllByText('+99.9%')).toHaveLength(1);
    // La tarjeta Clientes sigue mostrando su valor.
    expect(screen.getByText('Clientes')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
  });
});
