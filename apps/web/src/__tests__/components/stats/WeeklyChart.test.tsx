/**
 * Pruebas de `WeeklyChart` (`src/components/stats/WeeklyChart.tsx`).
 * Verifica que renderiza los valores y días, y que las alturas de las barras
 * son proporcionales al máximo de reservas.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WeeklyChart } from '@/components/stats/WeeklyChart';
import type { WeeklyDataPoint } from '@/constants/stats';

const data: WeeklyDataPoint[] = [
  { day: 'Lun', reservas: 5, ventas: 100 },
  { day: 'Mar', reservas: 10, ventas: 200 }, // máximo
  { day: 'Mié', reservas: 0, ventas: 0 },
];

describe('components/stats/WeeklyChart', () => {
  it('muestra los días y las cantidades de reservas', () => {
    render(<WeeklyChart data={data} />);
    expect(screen.getByText('Lun')).toBeInTheDocument();
    expect(screen.getByText('Mar')).toBeInTheDocument();
    expect(screen.getByText('Mié')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('escala las barras respecto del máximo (el máximo llega a 100%)', () => {
    const { container } = render(<WeeklyChart data={data} />);
    const heights = Array.from(container.querySelectorAll('div[style]')).map(
      (el) => (el as HTMLElement).style.height
    );
    expect(heights).toContain('100%'); // Mar (10) = máximo
    expect(heights).toContain('50%'); // Lun (5) = mitad
    expect(heights).toContain('0%'); // Mié (0)
  });
});
