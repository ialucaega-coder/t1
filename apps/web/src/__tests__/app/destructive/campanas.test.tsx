/**
 * /campanas: el envío masivo y el borrado de una campaña piden confirmación
 * antes de ejecutarse (el envío muestra la cantidad de destinatarios).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const toastMock = vi.fn();
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ toast: toastMock }) }));

const sendCampaign = vi.fn().mockResolvedValue(undefined);
const deleteCampaign = vi.fn().mockResolvedValue(undefined);
const campaign = {
  id: 'c1',
  name: 'Promo Verano',
  description: 'hola',
  channel: 'whatsapp',
  status: 'draft',
  scheduledAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  sentCount: 0,
  openRate: 0,
  clickRate: 0,
};
vi.mock('@/hooks/use-campaigns', () => ({
  useCampaigns: () => ({
    campaigns: [campaign],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    createCampaign: vi.fn(),
    updateCampaign: vi.fn(),
    deleteCampaign,
    sendCampaign,
  }),
}));
vi.mock('@/lib/api/campaigns', () => ({
  getRecipients: vi.fn().mockResolvedValue({ total: 42, recipients: [] }),
}));

import CampanasPage from '@/app/(dashboard)/campanas/page';

beforeEach(() => {
  sendCampaign.mockClear();
  deleteCampaign.mockClear();
});

describe('campanas: acciones irreversibles', () => {
  it('Enviar no dispara el envío hasta confirmar y muestra la cantidad de destinatarios', async () => {
    render(<CampanasPage />);
    fireEvent.click(screen.getByRole('button', { name: /^Enviar$/ }));

    expect(sendCampaign).not.toHaveBeenCalled();
    expect(await screen.findByText(/a 42 clientes/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Enviar ahora' }));
    await waitFor(() => expect(sendCampaign).toHaveBeenCalledWith('c1'));
  });

  it('cancelar el diálogo de envío no envía nada', async () => {
    render(<CampanasPage />);
    fireEvent.click(screen.getByRole('button', { name: /^Enviar$/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(sendCampaign).not.toHaveBeenCalled();
  });

  it('borrar una campaña pide confirmación', async () => {
    render(<CampanasPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar campaña' }));

    expect(deleteCampaign).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(deleteCampaign).toHaveBeenCalledWith('c1'));
  });
});
