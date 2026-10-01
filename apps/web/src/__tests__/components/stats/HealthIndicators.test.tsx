/**
 * Pruebas de `HealthIndicators` (`src/components/stats/HealthIndicators.tsx`).
 * Lo valioso es la lógica de tendencia:
 *  - umbral de visibilidad del cambio (|change| >= 0.1),
 *  - indicadores "inversos" (no-show/cancelación): bajar es BUENO (verde),
 *  - indicadores normales: subir es bueno (verde).
 * También cubre el estado de carga y el fallback silencioso si la API falla.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const getHealthIndicators = vi.fn();
vi.mock('@/lib/api/index', () => ({ statsApi: { getHealthIndicators: () => getHealthIndicators() } }));

import { HealthIndicators } from '@/components/stats/HealthIndicators';

beforeEach(() => vi.clearAllMocks());

describe('components/stats/HealthIndicators', () => {
  it('muestra el estado de carga inicial', () => {
    getHealthIndicators.mockReturnValue(new Promise(() => {})); // nunca resuelve
    render(<HealthIndicators />);
    expect(screen.getByText('Calculando...')).toBeInTheDocument();
  });

  it('aplica el color de tendencia correcto según sea normal o inverso', async () => {
    getHealthIndicators.mockResolvedValue({
      indicators: [
        { key: 'confirmation_rate', label: 'Tasa de confirmación', value: '80%', numericValue: 80, good: true, change: 2.5 },
        { key: 'no_show_rate', label: 'Tasa de no-show', value: '5%', numericValue: 5, good: true, change: -1.0 },
        { key: 'cancellation_rate', label: 'Tasa de cancelación', value: '3%', numericValue: 3, good: false, change: 0.5 },
        { key: 'retention_rate', label: 'Retención mensual', value: '60%', numericValue: 60, good: true, change: 0.05 },
      ],
    });

    render(<HealthIndicators />);
    await waitFor(() => expect(screen.getByText('Tasa de confirmación')).toBeInTheDocument());

    // Normal, sube => verde.
    expect(screen.getByText('2.5').className).toContain('text-emerald-400');
    // Inverso, baja (change<0) => bueno => verde.
    expect(screen.getByText('1.0').className).toContain('text-emerald-400');
    // Inverso, sube (change>0) => malo => rojo.
    expect(screen.getByText('0.5').className).toContain('text-red-400');
    // |change| 0.05 < 0.1 => no se muestra el badge de cambio.
    expect(screen.queryByText('0.1')).toBeNull();
  });

  it('cae al fallback silencioso cuando la API falla (sin romper)', async () => {
    getHealthIndicators.mockRejectedValue(new Error('boom'));
    render(<HealthIndicators />);
    await waitFor(() => expect(screen.getByText('Tasa de confirmación')).toBeInTheDocument());
    // Los valores de fallback muestran el guion largo.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
