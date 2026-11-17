/**
 * /conexiones: desconectar Telegram respeta el resultado (no muestra éxito si
 * falló) y el diálogo de borrar webhook espera el resultado antes de cerrarse.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const toastMock = vi.fn();
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ toast: toastMock }) }));

vi.mock('@/app/(dashboard)/conexiones/MetaChannelCard', () => ({ MetaChannelCard: () => null }));
vi.mock('@/app/(dashboard)/conexiones/WhatsAppCard', () => ({ WhatsAppCard: () => null }));
vi.mock('@/app/(dashboard)/conexiones/CalcomCard', () => ({ CalcomCard: () => null }));
vi.mock('@/app/(dashboard)/conexiones/MercadoPagoCard', () => ({ MercadoPagoCard: () => null }));
vi.mock('@/app/(dashboard)/conexiones/ManyChatCard', () => ({ ManyChatCard: () => null }));
vi.mock('@/app/(dashboard)/conexiones/ComposioCard', () => ({ ComposioCard: () => null }));

const disconnectTelegram = vi.fn();
vi.mock('@/hooks/use-connections', () => ({
  useConnections: () => ({
    telegramStatus: { connected: true, bot: { username: 'mibot', name: 'Mi Bot', connectedAt: null } },
    isTelegramLoading: false,
    telegramError: null,
    connectTelegram: vi.fn(),
    disconnectTelegram,
    refreshTelegramStatus: vi.fn(),
  }),
}));
vi.mock('@/hooks/use-bots', () => ({ useBots: () => ({ bots: [] }) }));
vi.mock('@/lib/api/index', () => ({
  integrationsApi: {
    getIntegrationRequests: vi.fn().mockResolvedValue({ requested: [] }),
    setIntegrationRequest: vi.fn(),
  },
}));

const deleteWebhook = vi.fn();
vi.mock('@/lib/api/webhooks', () => ({
  getWebhooks: vi.fn().mockResolvedValue([
    { id: 'w1', name: 'Zapier', url: 'https://hooks.example.com/x', events: ['booking.created'], isActive: true },
  ]),
  deleteWebhook: (...a: unknown[]) => deleteWebhook(...a),
  createWebhook: vi.fn(),
  updateWebhook: vi.fn(),
  testWebhook: vi.fn(),
}));

import ConexionesPage from '@/app/(dashboard)/conexiones/page';

beforeEach(() => {
  toastMock.mockReset();
  disconnectTelegram.mockReset();
  deleteWebhook.mockReset();
});

describe('conexiones: Telegram', () => {
  it('si desconectar devuelve false muestra error y no el éxito', async () => {
    disconnectTelegram.mockResolvedValue(false);
    render(<ConexionesPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Desconectar bot' }));
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })),
    );
    expect(toastMock).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('si desconectar sale bien muestra el éxito', async () => {
    disconnectTelegram.mockResolvedValue(true);
    render(<ConexionesPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Desconectar bot' }));
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' })),
    );
  });
});

describe('conexiones: webhooks', () => {
  it('el diálogo de borrado sigue abierto mientras se resuelve y se cierra al terminar', async () => {
    let resolveDelete: () => void = () => {};
    deleteWebhook.mockReturnValue(new Promise<void>((res) => { resolveDelete = res; }));
    render(<ConexionesPage />);

    // Botón de borrar del webhook (único con ícono de papelera sin texto dentro de la fila).
    const urlLabel = await screen.findByText('https://hooks.example.com/x');
    const row = urlLabel.closest('div.rounded-xl') as HTMLElement;
    const buttons = row.querySelectorAll('button');
    fireEvent.click(buttons[buttons.length - 1]);

    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar' }));
    // Pendiente: el diálogo no se cierra antes de tener el resultado.
    expect(screen.getByText('¿Eliminar este webhook?')).toBeInTheDocument();

    await act(async () => {
      resolveDelete();
    });
    await waitFor(() => expect(screen.queryByText('¿Eliminar este webhook?')).not.toBeInTheDocument());
  });
});
