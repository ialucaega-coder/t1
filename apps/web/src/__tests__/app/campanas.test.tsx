/**
 * /campanas: estados con texto, programación en hora argentina (futura),
 * desprogramar, sin métricas falsas de apertura/clicks y errores reales del server.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';

const toastMock = vi.fn();
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ toast: toastMock }) }));

vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ business: { id: 'biz1' } }) }));
// Se captura el handler de cada evento de socket para dispararlo desde el test.
const socketHandlers: Record<string, (event?: unknown) => void> = {};
vi.mock('@/hooks/use-socket', () => ({
  useSocket: vi.fn(),
  useSocketEvent: (event: string, cb: (e?: unknown) => void) => {
    socketHandlers[event] = cb;
  },
}));

const refreshSilently = vi.fn();
const createCampaign = vi.fn();
const updateCampaign = vi.fn();
const sendCampaign = vi.fn();
let campaigns: Record<string, unknown>[] = [];
vi.mock('@/hooks/use-campaigns', () => ({
  useCampaigns: () => ({
    campaigns,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    refreshSilently,
    createCampaign,
    updateCampaign,
    deleteCampaign: vi.fn(),
    sendCampaign,
  }),
}));
vi.mock('@/lib/api/campaigns', () => ({
  getRecipients: vi.fn().mockResolvedValue({ total: 7, recipients: [] }),
}));

import CampanasPage from '@/app/(dashboard)/campanas/page';

const make = (over: Record<string, unknown>) => ({
  id: 'c1',
  name: 'Promo',
  description: null,
  channel: 'whatsapp',
  status: 'draft',
  sentCount: 0,
  scheduledAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

beforeEach(() => {
  campaigns = [];
  refreshSilently.mockReset();
  createCampaign.mockReset().mockResolvedValue(undefined);
  updateCampaign.mockReset().mockResolvedValue(undefined);
  sendCampaign.mockReset().mockResolvedValue(undefined);
  toastMock.mockReset();
});

describe('campanas: estados', () => {
  it('programada muestra la fecha y hora en hora de Argentina', () => {
    // 21:30 UTC = 18:30 en Argentina (UTC-3).
    campaigns = [make({ status: 'scheduled', scheduledAt: '2026-11-15T21:30:00.000Z' })];
    render(<CampanasPage />);

    expect(screen.getByText('Programada')).toBeInTheDocument();
    expect(screen.getByText(/15\/11\/2026, 18:30 \(hora de Argentina\)/)).toBeInTheDocument();
  });

  it('muestra texto para enviando, enviada, cancelada y fallida (no solo color)', () => {
    campaigns = [
      make({ id: '1', name: 'A', status: 'sending' }),
      make({ id: '2', name: 'B', status: 'sent', sentCount: 12 }),
      make({ id: '3', name: 'C', status: 'cancelled' }),
      make({
        id: '4',
        name: 'D',
        status: 'failed',
        scheduledAt: '2026-11-10T10:00:00.000Z',
        updatedAt: '2026-11-10T20:00:00.000Z', // 10 h después: venció
      }),
    ];
    render(<CampanasPage />);

    expect(screen.getByText('Enviando…')).toBeInTheDocument();
    expect(screen.getByText('Enviada')).toBeInTheDocument();
    expect(screen.getByText('12 enviados')).toBeInTheDocument();
    expect(screen.getByText('Cancelada')).toBeInTheDocument();
    expect(screen.getByText('No se envió')).toBeInTheDocument();
    expect(screen.getByText(/venció la hora programada hace más de 6 h/)).toBeInTheDocument();
  });

  it('una fallida que no venció explica que falló el envío y permite reintentar', () => {
    campaigns = [
      make({
        status: 'failed',
        scheduledAt: '2026-11-10T10:00:00.000Z',
        updatedAt: '2026-11-10T10:05:00.000Z',
      }),
    ];
    render(<CampanasPage />);

    expect(screen.getByText(/El envío falló/)).toBeInTheDocument();
    expect(screen.queryByText(/venció la hora programada/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar envío' })).toBeInTheDocument();
  });

  it('una cancelada no ofrece enviar', () => {
    campaigns = [make({ status: 'cancelled' })];
    render(<CampanasPage />);

    expect(screen.queryByRole('button', { name: /Enviar ahora|Reintentar envío/ })).not.toBeInTheDocument();
  });

  it('no muestra aperturas ni clicks (no hay tracking)', () => {
    campaigns = [make({ status: 'sent', sentCount: 3, openRate: 0, clickRate: 0 })];
    const { container } = render(<CampanasPage />);

    expect(container.textContent).not.toMatch(/apertura/i);
    expect(container.textContent).not.toMatch(/clicks/i);
    expect(container.textContent).not.toMatch(/\d+\s?%/);
  });
});

describe('campanas: programar y desprogramar', () => {
  it('Enviar ahora sigue pidiendo confirmación con la cantidad de destinatarios', async () => {
    campaigns = [make({ status: 'scheduled', scheduledAt: '2099-01-01T13:00:00.000Z' })];
    render(<CampanasPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Enviar ahora' }));
    expect(sendCampaign).not.toHaveBeenCalled();
    expect(await screen.findByText(/a 7 clientes/)).toBeInTheDocument();
    // Hay dos botones "Enviar ahora": el de la tarjeta y el de confirmación (el último, dentro del diálogo).
    const buttons = screen.getAllByRole('button', { name: 'Enviar ahora' });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(sendCampaign).toHaveBeenCalledWith('c1'));
  });

  it('Desprogramar manda scheduledAt: null', async () => {
    campaigns = [make({ status: 'scheduled', scheduledAt: '2099-01-01T13:00:00.000Z' })];
    render(<CampanasPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Desprogramar' }));
    await waitFor(() => expect(updateCampaign).toHaveBeenCalledWith('c1', { scheduledAt: null }));
  });

  it('crear con fecha pasada se rechaza en el front, sin llamar al server', async () => {
    render(<CampanasPage />);
    fireEvent.click(screen.getAllByRole('button', { name: /Nueva campaña|Crear campaña/ })[0]);

    fireEvent.change(screen.getByPlaceholderText('Ej: Promo Septiembre'), { target: { value: 'Mi campaña' } });
    fireEvent.change(screen.getByLabelText(/Programar envío/), { target: { value: '2020-01-01T10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/futuras/);
    expect(createCampaign).not.toHaveBeenCalled();
  });

  it('crear con fecha futura manda el ISO UTC interpretando la hora como argentina', async () => {
    render(<CampanasPage />);
    fireEvent.click(screen.getAllByRole('button', { name: /Nueva campaña|Crear campaña/ })[0]);

    fireEvent.change(screen.getByPlaceholderText('Ej: Promo Septiembre'), { target: { value: 'Mi campaña' } });
    fireEvent.change(screen.getByLabelText(/Programar envío/), { target: { value: '2099-01-01T10:00' } });
    expect(screen.getByText(/GMT-3/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }));

    await waitFor(() =>
      expect(createCampaign).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Mi campaña', scheduledAt: '2099-01-01T13:00:00.000Z' }),
      ),
    );
  });

  it('crear sin fecha no manda scheduledAt (queda borrador)', async () => {
    render(<CampanasPage />);
    fireEvent.click(screen.getAllByRole('button', { name: /Nueva campaña|Crear campaña/ })[0]);

    fireEvent.change(screen.getByPlaceholderText('Ej: Promo Septiembre'), { target: { value: 'Borrador' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }));

    await waitFor(() => expect(createCampaign).toHaveBeenCalled());
    expect(createCampaign.mock.calls[0][0]).not.toHaveProperty('scheduledAt');
  });

  it('editar una programada precarga la hora argentina y vaciarla desprograma', async () => {
    campaigns = [make({ status: 'scheduled', scheduledAt: '2099-01-01T13:00:00.000Z' })];
    render(<CampanasPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Editar campaña' }));
    const input = screen.getByLabelText(/Programar envío/) as HTMLInputElement;
    expect(input.value).toBe('2099-01-01T10:00');

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() =>
      expect(updateCampaign).toHaveBeenCalledWith('c1', expect.objectContaining({ scheduledAt: null })),
    );
  });

  it('editar una fallida sin tocar la fecha no manda scheduledAt (evita un 400 por fecha pasada)', async () => {
    campaigns = [make({ status: 'failed', scheduledAt: '2020-01-01T10:00:00.000Z', updatedAt: '2020-01-01T10:05:00.000Z' })];
    render(<CampanasPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Editar campaña' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(updateCampaign).toHaveBeenCalled());
    expect(updateCampaign.mock.calls[0][1]).not.toHaveProperty('scheduledAt');
  });
});

describe('campanas: errores del server', () => {
  it('muestra el mensaje real al guardar', async () => {
    createCampaign.mockRejectedValue(new Error('La fecha programada tiene que ser futura'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<CampanasPage />);
    fireEvent.click(screen.getAllByRole('button', { name: /Nueva campaña|Crear campaña/ })[0]);
    fireEvent.change(screen.getByPlaceholderText('Ej: Promo Septiembre'), { target: { value: 'X campaña' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({ type: 'error', message: 'La fecha programada tiene que ser futura' }),
    );
  });

  it('muestra el mensaje real al desprogramar', async () => {
    campaigns = [make({ status: 'scheduled', scheduledAt: '2099-01-01T13:00:00.000Z' })];
    updateCampaign.mockRejectedValue(new Error('La campaña ya fue enviada o se está enviando'));
    render(<CampanasPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Desprogramar' }));
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({
        type: 'error',
        message: 'La campaña ya fue enviada o se está enviando',
      }),
    );
    expect(within(document.body).queryByText('Campaña desprogramada: volvió a borrador')).not.toBeInTheDocument();
  });
});

describe('campanas: cancelar y actualización por socket', () => {
  it('Cancelar pide confirmación explicando que no se enviará y recién ahí cancela', async () => {
    campaigns = [make({ status: 'scheduled', scheduledAt: '2099-01-01T13:00:00.000Z' })];
    render(<CampanasPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(updateCampaign).not.toHaveBeenCalled();
    expect(await screen.findByText(/no se va a enviar/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sí, cancelar campaña' }));
    await waitFor(() => expect(updateCampaign).toHaveBeenCalledWith('c1', { status: 'cancelled' }));
  });

  it('volver en el diálogo no cancela nada', async () => {
    campaigns = [make({ status: 'scheduled', scheduledAt: '2099-01-01T13:00:00.000Z' })];
    render(<CampanasPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Volver' }));
    expect(updateCampaign).not.toHaveBeenCalled();
  });

  it('si cancelar falla muestra el error real del server', async () => {
    campaigns = [make({ status: 'scheduled', scheduledAt: '2099-01-01T13:00:00.000Z' })];
    updateCampaign.mockRejectedValue(new Error('La campaña ya fue enviada o se está enviando'));
    render(<CampanasPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sí, cancelar campaña' }));
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({ type: 'error', message: 'La campaña ya fue enviada o se está enviando' }),
    );
  });

  it('solo las programadas se pueden cancelar', () => {
    campaigns = [make({ status: 'draft' })];
    render(<CampanasPage />);
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
  });

  it('cuando llega campaign:sent refresca la lista y el texto ya no pide recargar', () => {
    campaigns = [make({ status: 'sending' })];
    const { container } = render(<CampanasPage />);

    expect(container.textContent).not.toMatch(/Actualizá la página/);
    expect(refreshSilently).not.toHaveBeenCalled();
    act(() => socketHandlers['campaign:sent']());
    expect(refreshSilently).toHaveBeenCalledTimes(1);
  });
});

describe('campanas: evento campaign:progress', () => {
  const prog = (over: Record<string, unknown> = {}) => ({
    campaignId: 'c1',
    progress: { enviados: 25, fallidos: 0, procesados: 25, total: 100, ...over },
  });

  it('sin evento de avance no muestra la barra', () => {
    campaigns = [make({ status: 'sending' })];
    render(<CampanasPage />);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('muestra la barra con el porcentaje y los conteos de una campaña enviándose', () => {
    campaigns = [make({ status: 'sending' })];
    render(<CampanasPage />);
    act(() => socketHandlers['campaign:progress'](prog()));

    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '25');
    expect(screen.getByText(/25 de 100 procesados · 25 enviados/)).toBeInTheDocument();
  });

  it('informa los mensajes con error cuando los hay', () => {
    campaigns = [make({ status: 'sending' })];
    render(<CampanasPage />);
    act(() => socketHandlers['campaign:progress'](prog({ fallidos: 3, procesados: 28 })));
    expect(screen.getByText(/3 con error/)).toBeInTheDocument();
  });

  it('ignora eventos mal formados sin romper', () => {
    campaigns = [make({ status: 'sending' })];
    render(<CampanasPage />);
    expect(() => {
      act(() => socketHandlers['campaign:progress'](undefined));
      act(() => socketHandlers['campaign:progress']({ campaignId: 'c1' }));
      act(() => socketHandlers['campaign:progress']({ progress: { total: 1, procesados: 1 } }));
    }).not.toThrow();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('no muestra la barra si la campaña ya no está enviándose', () => {
    campaigns = [make({ status: 'sent', sentCount: 100 })];
    render(<CampanasPage />);
    act(() => socketHandlers['campaign:progress'](prog()));
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('al llegar campaign:sent se descarta el avance', () => {
    campaigns = [make({ status: 'sending' })];
    render(<CampanasPage />);
    act(() => socketHandlers['campaign:progress'](prog()));
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    act(() => socketHandlers['campaign:sent']({ campaign: { id: 'c1' } }));
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});

describe('campanas: evento campaign:failed', () => {
  const failedCampaign = { id: 'c1', name: 'Promo Verano' };

  it("reason 'retries_exhausted' refresca y avisa con la cantidad de mensajes fallidos", () => {
    campaigns = [make({ status: 'sending' })];
    render(<CampanasPage />);

    act(() => {
      socketHandlers['campaign:failed']({
        campaign: failedCampaign,
        envio: { enviados: 3, fallidos: 5 },
        reason: 'retries_exhausted',
      });
    });

    expect(refreshSilently).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith({
      type: 'error',
      message: 'No se pudo enviar la campaña Promo Verano: 5 mensajes fallaron',
    });
  });

  it("reason 'expired' (sin envio) avisa que venció la hora programada", () => {
    campaigns = [make({ status: 'sending' })];
    render(<CampanasPage />);

    act(() => {
      socketHandlers['campaign:failed']({ campaign: failedCampaign, reason: 'expired' });
    });

    expect(refreshSilently).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith({
      type: 'error',
      message: 'La campaña Promo Verano no se envió: venció la hora programada hace más de 6 h',
    });
  });

  it('un evento sin envio ni reason no rompe y igual refresca', () => {
    render(<CampanasPage />);

    act(() => {
      socketHandlers['campaign:failed']({ campaign: failedCampaign });
    });

    expect(refreshSilently).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith({ type: 'error', message: 'No se pudo enviar la campaña Promo Verano' });
  });

  it('un payload vacío no rompe', () => {
    render(<CampanasPage />);
    expect(() => act(() => socketHandlers['campaign:failed'](undefined))).not.toThrow();
  });

  it('el motivo del evento se usa en la tarjeta (en vez de la heurística) hasta recargar', () => {
    // Sin updatedAt la heurística diría "El envío falló"; el evento dice que venció.
    campaigns = [make({ status: 'failed', scheduledAt: '2026-11-10T10:00:00.000Z', updatedAt: '2026-11-10T10:01:00.000Z' })];
    render(<CampanasPage />);
    expect(screen.getByText(/El envío falló/)).toBeInTheDocument();

    act(() => {
      socketHandlers['campaign:failed']({ campaign: failedCampaign, reason: 'expired' });
    });

    expect(screen.getByText(/venció la hora programada hace más de 6 h/)).toBeInTheDocument();
    expect(screen.queryByText(/El envío falló/)).not.toBeInTheDocument();
  });
});
