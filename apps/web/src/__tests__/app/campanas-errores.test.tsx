/**
 * /campanas:
 *  - Si el listado falla se muestra solo el error (no "No hay campañas").
 *  - El toast tras enviar es honesto: con colas el estado queda `sending`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const toast = vi.fn();
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ business: { id: 'biz1' } }) }));
vi.mock('@/hooks/use-socket', () => ({ useSocket: vi.fn(), useSocketEvent: vi.fn() }));

const sendCampaign = vi.fn();
let campaigns: Record<string, unknown>[] = [];
let error: string | null = null;
vi.mock('@/hooks/use-campaigns', () => ({
  useCampaigns: () => ({
    campaigns, isLoading: false, error, refetch: vi.fn(), refreshSilently: vi.fn(),
    createCampaign: vi.fn(), updateCampaign: vi.fn(), deleteCampaign: vi.fn(), sendCampaign,
  }),
}));
vi.mock('@/lib/api/campaigns', () => ({
  getRecipients: vi.fn().mockResolvedValue({ total: 7, recipients: [] }),
}));

import CampanasPage from '@/app/(dashboard)/campanas/page';

const draft = {
  id: 'c1', name: 'Promo', description: null, channel: 'whatsapp', status: 'draft', sentCount: 0,
  scheduledAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  campaigns = [];
  error = null;
});

describe('campanas: listado con error', () => {
  it('muestra el error y NO el vacío "No hay campañas"', () => {
    error = 'Error al cargar campañas';
    render(<CampanasPage />);
    expect(screen.getByText('Error al cargar campañas')).toBeInTheDocument();
    expect(screen.queryByText('No hay campañas')).toBeNull();
  });

  it('sin error y sin campañas sí muestra el vacío', () => {
    render(<CampanasPage />);
    expect(screen.getByText('No hay campañas')).toBeInTheDocument();
  });
});

describe('campanas: toast de envío honesto', () => {
  async function sendAndConfirm() {
    campaigns = [draft];
    render(<CampanasPage />);
    fireEvent.click(screen.getByRole('button', { name: /Enviar/ }));
    const dialog = await screen.findByRole('alertdialog');
    const confirm = Array.from(dialog.querySelectorAll('button')).find((b) => /Enviar/.test(b.textContent || ''))!;
    fireEvent.click(confirm);
  }

  it('con colas (status sending) dice "en proceso de envío", no "enviada correctamente"', async () => {
    sendCampaign.mockResolvedValue({ ...draft, status: 'sending' });
    await sendAndConfirm();
    await waitFor(() => expect(toast).toHaveBeenCalled());
    const msg = toast.mock.calls[0][0].message as string;
    expect(msg).toContain('en proceso de envío');
    expect(msg).not.toContain('enviada correctamente');
  });

  it('si el envío ya terminó (inline) sí dice enviada correctamente', async () => {
    sendCampaign.mockResolvedValue({ ...draft, status: 'sent' });
    await sendAndConfirm();
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ type: 'success', message: 'Campaña enviada correctamente' }));
  });
});
