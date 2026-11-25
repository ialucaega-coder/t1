/** /analisis: la satisfacción se muestra como ESTIMADA (con texto de ayuda visible) y los costos dicen "del período" con rango. */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/use-campaigns', () => ({
  useCampaigns: () => ({ campaigns: [], isLoading: false, createCampaign: vi.fn(), deleteCampaign: vi.fn() }),
}));
const useAnalyticsMock = vi.fn();
vi.mock('@/hooks/use-analytics', () => ({ useAnalytics: (...a: unknown[]) => useAnalyticsMock(...a) }));

import AnalisisPage from '@/app/(dashboard)/analisis/page';

const DATA = {
  kpi: {
    totalConversations: 10, conversationsChange: 1, avgSatisfaction: 4.1, satisfactionChange: 0.2,
    monthlyAiCost: 2, aiCostChange: 0, conversionRate: 30, conversionChange: 0, monthlyBudget: 50,
    estimated: true, basis: 'estado_de_conversaciones',
  },
  conversations: [], improvements: [], costs: [], metrics: [], timeseries: [], funnel: null, attribution: null,
  satisfaction: [
    { stars: 5, count: 6, color: '#22c55e', estimated: true },
    { stars: 4, count: 3, color: '#84cc16', estimated: true },
  ],
  isLoading: false, error: null, refetch: vi.fn(),
};

describe('analisis — satisfacción estimada y costos', () => {
  it('rotula "Satisfacción estimada" con la ayuda visible y sin estrellas', () => {
    useAnalyticsMock.mockReturnValue(DATA);
    const { container } = render(<AnalisisPage />);

    expect(screen.getAllByText('Satisfacción estimada').length).toBeGreaterThanOrEqual(2); // tarjeta KPI + gráfico
    expect(
      screen.getAllByText('Se estima según cómo terminan las conversaciones; todavía no se piden calificaciones a los clientes.').length,
    ).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Nivel 5 de 5')).toBeInTheDocument();
    expect(container.textContent).not.toContain('★');
  });

  it('el costo dice "mensual" sin rango y pasa a "del período" al elegir un rango', () => {
    useAnalyticsMock.mockReturnValue(DATA);
    render(<AnalisisPage />);
    expect(screen.getByText('Costo IA mensual')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '7 días' }));
    expect(screen.getByText('Costo IA del período')).toBeInTheDocument();
    expect(screen.queryByText('Costo IA mensual')).toBeNull();
  });

  it('en la pestaña Costos el presupuesto no dice "mensual" cuando hay rango', () => {
    useAnalyticsMock.mockReturnValue(DATA);
    render(<AnalisisPage />);
    fireEvent.click(screen.getByRole('button', { name: '30 días' }));
    fireEvent.click(screen.getByRole('button', { name: /Costos/ }));

    expect(screen.getByText('Presupuesto de referencia')).toBeInTheDocument();
    expect(screen.queryByText('Presupuesto mensual')).toBeNull();
  });
});
