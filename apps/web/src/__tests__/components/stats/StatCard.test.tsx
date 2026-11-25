/**
 * Pruebas de componente para `StatCard` (`src/components/stats/StatCard.tsx`).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Users } from 'lucide-react';
import { StatCard } from '@/components/stats/StatCard';
import type { StatCard as StatCardType } from '@/constants/stats';

function makeStat(overrides: Partial<StatCardType> = {}): StatCardType {
  return {
    label: 'Conversaciones',
    value: '1,284',
    change: '+12%',
    trend: 'up',
    icon: Users,
    ...overrides,
  };
}

describe('components/stats/StatCard', () => {
  it('muestra el valor y la etiqueta', () => {
    render(<StatCard stat={makeStat()} />);

    expect(screen.getByText('1,284')).toBeInTheDocument();
    expect(screen.getByText('Conversaciones')).toBeInTheDocument();
  });

  it('muestra el cambio porcentual', () => {
    render(<StatCard stat={makeStat({ change: '+8%' })} />);

    expect(screen.getByText('+8%')).toBeInTheDocument();
  });

  it('usa color verde (emerald) para tendencia hacia arriba', () => {
    render(<StatCard stat={makeStat({ trend: 'up', change: '+5%' })} />);

    // El contenedor del cambio lleva la clase de color segun la tendencia
    const changeEl = screen.getByText('+5%').closest('div');
    expect(changeEl?.className).toContain('text-emerald-400');
  });

  it('usa color rojo para tendencia hacia abajo', () => {
    render(<StatCard stat={makeStat({ trend: 'down', change: '-15%' })} />);

    const changeEl = screen.getByText('-15%').closest('div');
    expect(changeEl?.className).toContain('text-red-400');
  });
});
