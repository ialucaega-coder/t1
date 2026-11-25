/** /estadisticas: elegir un rango recarga con ese rango y "Exportar CSV" baja lo que se ve. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const useStatsMock = vi.fn();
vi.mock('@/hooks/use-stats', () => ({ useStats: (...a: unknown[]) => useStatsMock(...a) }));
vi.mock('@/components/stats/HealthIndicators', () => ({ HealthIndicators: () => null }));
const downloadCsv = vi.fn();
vi.mock('@/lib/csv', () => ({ downloadCsv: (...a: unknown[]) => downloadCsv(...a), toCsv: vi.fn(), csvCell: vi.fn() }));

import EstadisticasPage from '@/app/(dashboard)/estadisticas/page';

const OVERVIEW = {
  todayBookings: 1, monthBookings: 10, bookingChange: '+5.0%', totalClients: 7, revenue: 2500,
  revenueChange: '-2.0%', activeServices: 2, totalProducts: 1, noShowRate: '4.0%', noShowChange: '-1.0%',
};

beforeEach(() => {
  vi.clearAllMocks();
  useStatsMock.mockReturnValue({
    overview: OVERVIEW,
    weeklyData: [{ date: '2026-10-05', day: 'lun', bookings: 2, revenue: 100 }],
    topServices: [{ id: 's1', name: 'Corte', bookingCount: 4 }],
    isLoading: false, error: null, refetch: vi.fn(),
  });
});

describe('estadisticas — rango y exportación', () => {
  it('arranca sin rango y al elegir "7 días" vuelve a pedir los datos con ese rango', () => {
    render(<EstadisticasPage />);
    expect(useStatsMock).toHaveBeenLastCalledWith({ kind: 'default' });

    fireEvent.click(screen.getByRole('button', { name: '7 días' }));
    expect(useStatsMock).toHaveBeenLastCalledWith({ kind: 'preset', days: 7 });
  });

  it('Exportar CSV descarga las filas de lo cargado con un nombre de archivo .csv', () => {
    render(<EstadisticasPage />);
    fireEvent.click(screen.getByRole('button', { name: /Exportar CSV/ }));

    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [filename, rows] = downloadCsv.mock.calls[0] as [string, unknown[][]];
    expect(filename).toMatch(/^estadisticas-default-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(rows).toContainEqual(['Top servicios', 'Corte', 4, '']);
    expect(rows).toContainEqual(['Reservas por día', '2026-10-05', 2, 'lun']);
  });

  it('con la página cargando o sin datos, Exportar CSV está deshabilitado', () => {
    useStatsMock.mockReturnValue({ overview: null, weeklyData: [], topServices: [], isLoading: true, error: null, refetch: vi.fn() });
    render(<EstadisticasPage />);
    expect((screen.getByRole('button', { name: /Exportar CSV/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
