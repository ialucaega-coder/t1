import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const toast = vi.hoisted(() => vi.fn());
const api = vi.hoisted(() => ({
  getMrGoAgents: vi.fn(),
  runMrGo: vi.fn(),
  resumeMrGo: vi.fn(),
  getMrGoMemory: vi.fn(),
  saveMrGoMemory: vi.fn(),
  getMrGoOffice: vi.fn(),
  saveMrGoOffice: vi.fn(),
  getMrGoIndustry: vi.fn(),
  saveMrGoIndustry: vi.fn(),
  saveMrGoAgents: vi.fn(),
}));

vi.mock('@/lib/api/mrgo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/mrgo')>();
  return { ...actual, ...api };
});
vi.mock('@/lib/api/industryTemplates', () => ({ getIndustryTemplates: vi.fn().mockResolvedValue([]) }));
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/mrgo/MrGoAvatar', () => ({ MrGoAvatar: () => null }));
vi.mock('@/components/mrgo/OfficeFloorLive', () => ({ OfficeFloorLive: () => null }));
vi.mock('@/components/mrgo/AgentCard', () => ({ AgentCard: () => null }));
vi.mock('@/components/mrgo/CommandPanel', () => ({ CommandPanel: () => null }));
vi.mock('@/components/mrgo/useAgentActivity', () => ({
  useAgentActivity: () => ({ activity: {}, play: vi.fn(), reset: vi.fn() }),
}));

import OficinaPage from '@/app/(dashboard)/oficina/page';

const PHONE = '+5491155551234';

function pendingRun() {
  return {
    agent: 'ceo',
    emotion: 'neutral',
    steps: [],
    finalMessage: '',
    stoppedReason: 'needs_confirmation',
    pending: {
      tool: 'enviar_whatsapp',
      kind: 'externo',
      thought: 'Avisarle al cliente del turno',
      params: { to: PHONE, message: 'Hola Ana, tu turno es mañana a las 10', amount: 1500.5, campaignName: 'Black Friday' },
    },
  };
}

async function despacharYAbrirAskMe() {
  render(<OficinaPage />);
  const textarea = await screen.findByPlaceholderText(/Describí la tarea/);
  fireEvent.change(textarea, { target: { value: 'Avisale a Ana de su turno' } });
  fireEvent.click(screen.getByRole('button', { name: /Despachar orden/ }));
  await waitFor(() => expect(api.runMrGo).toHaveBeenCalled());
  fireEvent.click(await screen.findByTitle('ask me'));
}

describe('OficinaPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getMrGoAgents.mockResolvedValue({
      agents: [{ key: 'ceo', activo: true }],
      roles: [{ key: 'ceo', nombre: 'Mr Go', color: '#7c3aed', descripcion: 'CEO' }],
      tools: [{ key: 'enviar_whatsapp', nombre: 'Enviar WhatsApp', descripcion: '', endpoint: '' }],
      roleTools: {},
    });
    api.getMrGoMemory.mockResolvedValue({ profile: 'Peluquería', facts: ['Abrimos de 9 a 18'] });
    api.getMrGoOffice.mockResolvedValue({ paused: [], positions: {} });
    api.getMrGoIndustry.mockResolvedValue({ giroId: '' });
  });

  describe('A3: tarjeta Ask me', () => {
    it('muestra qué se aprueba: mensaje, monto y campaña, con el teléfono enmascarado', async () => {
      api.runMrGo.mockResolvedValue(pendingRun());
      await despacharYAbrirAskMe();

      expect(await screen.findByText('Hola Ana, tu turno es mañana a las 10')).toBeInTheDocument();
      expect(screen.getByText('$ 1.500,5')).toBeInTheDocument();
      expect(screen.getByText('Black Friday')).toBeInTheDocument();
      expect(screen.getByText('+54•••••234')).toBeInTheDocument();
      expect(screen.getByText('Avisarle al cliente del turno')).toBeInTheDocument();
      // el número completo no se muestra
      expect(document.body.textContent).not.toContain(PHONE);
    });
  });

  describe('M5: toast tras confirmar', () => {
    const resumed = (status: string, detail: string, ok: boolean) => ({
      agent: 'ceo',
      emotion: 'neutral',
      finalMessage: 'Mensaje enviado',
      stoppedReason: 'final',
      steps: [{ tool: 'enviar_whatsapp', params: {}, result: { action: 'enviar_whatsapp', kind: 'externo', ok, status, detail } }],
    });

    it('si el último paso fue omitido avisa el motivo en vez de "Listo"', async () => {
      api.runMrGo.mockResolvedValue(pendingRun());
      api.resumeMrGo.mockResolvedValue(resumed('omitido', 'falta el teléfono del cliente', false));
      await despacharYAbrirAskMe();
      fireEvent.click(await screen.findByRole('button', { name: /Confirmar y ejecutar/ }));

      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'warning', message: expect.stringContaining('falta el teléfono del cliente') }),
        ),
      );
      expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
    });

    it('si el último paso fue error muestra un toast de error con el motivo', async () => {
      api.runMrGo.mockResolvedValue(pendingRun());
      api.resumeMrGo.mockResolvedValue(resumed('error', 'WhatsApp no está conectado', false));
      await despacharYAbrirAskMe();
      fireEvent.click(await screen.findByRole('button', { name: /Confirmar y ejecutar/ }));

      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'error', message: expect.stringContaining('WhatsApp no está conectado') }),
        ),
      );
    });

    it('si se ejecutó bien sigue diciendo "Listo"', async () => {
      api.runMrGo.mockResolvedValue(pendingRun());
      api.resumeMrGo.mockResolvedValue(resumed('ejecutado', 'enviado', true));
      await despacharYAbrirAskMe();
      fireEvent.click(await screen.findByRole('button', { name: /Confirmar y ejecutar/ }));

      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith({ type: 'success', message: 'Listo: Mensaje enviado' }),
      );
    });
  });

  describe('M6: memoria', () => {
    it('si la carga falla bloquea el guardado, muestra el error y deja Reintentar', async () => {
      api.getMrGoMemory.mockRejectedValueOnce(new Error('Sin conexión'));
      render(<OficinaPage />);
      fireEvent.click(await screen.findByTitle('memory'));

      expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar la memoria (Sin conexión)');
      const guardar = screen.getByRole('button', { name: /Guardar memoria/ });
      expect(guardar).toBeDisabled();
      fireEvent.click(guardar);
      expect(api.saveMrGoMemory).not.toHaveBeenCalled();

      // Reintentar: carga bien y se habilita el guardado con lo real.
      fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
      await waitFor(() => expect(screen.getByRole('button', { name: /Guardar memoria/ })).toBeEnabled());
      expect(screen.getByDisplayValue('Peluquería')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('con la memoria cargada se puede guardar', async () => {
      api.saveMrGoMemory.mockResolvedValue({ profile: 'Peluquería', facts: ['Abrimos de 9 a 18'] });
      render(<OficinaPage />);
      fireEvent.click(await screen.findByTitle('memory'));
      const guardar = await screen.findByRole('button', { name: /Guardar memoria/ });
      await waitFor(() => expect(guardar).toBeEnabled());
      fireEvent.click(guardar);
      await waitFor(() =>
        expect(api.saveMrGoMemory).toHaveBeenCalledWith({ profile: 'Peluquería', facts: ['Abrimos de 9 a 18'] }),
      );
    });
  });
});
