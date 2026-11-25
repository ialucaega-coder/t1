/**
 * /analisis:
 *  - La pestaña Campañas usa los estados reales del server (minúscula) vía
 *    describeCampaignStatus y borra con ConfirmDialog, manejando el error.
 *  - Con error de carga no se muestran ceros como datos: las tarjetas dicen "—".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const toast = vi.fn();
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ toast }) }));

const deleteCampaign = vi.fn();
let campaigns: Record<string, unknown>[] = [];
vi.mock('@/hooks/use-campaigns', () => ({
  useCampaigns: () => ({ campaigns, isLoading: false, error: null, createCampaign: vi.fn(), deleteCampaign }),
}));
const useAnalyticsMock = vi.fn();
vi.mock('@/hooks/use-analytics', () => ({ useAnalytics: (...a: unknown[]) => useAnalyticsMock(...a) }));

import AnalisisPage from '@/app/(dashboard)/analisis/page';

const baseData = {
  kpi: {
    totalConversations: 0, conversationsChange: 0, avgSatisfaction: 0, satisfactionChange: 0,
    monthlyAiCost: 0, aiCostChange: 0, conversionRate: 0, conversionChange: 0, monthlyBudget: 50,
  },
  conversations: [], improvements: [], costs: [], metrics: [], timeseries: [], funnel: null, attribution: null,
  satisfaction: [], isLoading: false, error: null, refetch: vi.fn(),
};

const camp = (over: Record<string, unknown>) => ({
  id: 'c1', name: 'Promo', description: null, channel: 'whatsapp', status: 'draft', sentCount: 0,
  scheduledAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  campaigns = [];
  deleteCampaign.mockResolvedValue(undefined);
  useAnalyticsMock.mockReturnValue(baseData);
});

function openCampanasTab() {
  render(<AnalisisPage />);
  fireEvent.click(screen.getByRole('button', { name: /Campañas/ }));
}

describe('analisis: pestaña Campañas', () => {
  it('muestra el estado real del server en minúscula (sent, scheduled, failed, draft)', () => {
    campaigns = [
      camp({ id: 'a', name: 'A', status: 'sent' }),
      camp({ id: 'b', name: 'B', status: 'scheduled', scheduledAt: '2026-11-15T21:30:00.000Z' }),
      camp({ id: 'c', name: 'C', status: 'failed' }),
      camp({ id: 'd', name: 'D', status: 'draft' }),
    ];
    openCampanasTab();
    expect(screen.getByText('Enviada')).toBeInTheDocument();
    expect(screen.getByText('Programada')).toBeInTheDocument();
    expect(screen.getByText('No se envió')).toBeInTheDocument();
    expect(screen.getByText('Borrador')).toBeInTheDocument();
  });

  it('borrar pide confirmación y recién al confirmar elimina', async () => {
    campaigns = [camp({})];
    openCampanasTab();
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Promo' }));

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(deleteCampaign).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(deleteCampaign).toHaveBeenCalledWith('c1'));
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ type: 'success', message: 'Campaña eliminada correctamente' }));
  });

  it('cancelar el diálogo no borra nada', async () => {
    campaigns = [camp({})];
    openCampanasTab();
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Promo' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(deleteCampaign).not.toHaveBeenCalled();
  });

  it('si borrar falla muestra el error real (sin excepción sin atrapar)', async () => {
    deleteCampaign.mockRejectedValue(new Error('Campaign not found'));
    campaigns = [camp({})];
    openCampanasTab();
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Promo' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ type: 'error', message: 'Campaign not found' }));
  });
});

describe('analisis: error de carga', () => {
  it('muestra "—" en las tarjetas y no ceros ni +0% como si fueran datos', () => {
    useAnalyticsMock.mockReturnValue({ ...baseData, error: 'Error al cargar análisis' });
    const { container } = render(<AnalisisPage />);

    expect(screen.getByText('Error al cargar análisis')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4);
    expect(container.textContent).not.toContain('+0%');
    expect(container.textContent).not.toContain('0%');
    // Sin datos falsos en la pestaña activa.
    expect(screen.queryByText('Conversaciones por día')).toBeNull();
  });

  it('sin error muestra los valores reales', () => {
    useAnalyticsMock.mockReturnValue({
      ...baseData,
      kpi: { ...baseData.kpi, totalConversations: 12, conversationsChange: 5, conversionRate: 30 },
    });
    render(<AnalisisPage />);
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('30%')).toBeInTheDocument();
    expect(screen.queryByText('—')).toBeNull();
  });
});
