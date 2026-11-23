import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const toast = vi.hoisted(() => vi.fn());
const ai = vi.hoisted(() => ({
  getSystemPrompt: vi.fn(),
  saveSystemPrompt: vi.fn(),
  generatePrompt: vi.fn(),
  sendChatMessage: vi.fn(),
  getEngines: vi.fn(),
  setEngine: vi.fn(),
  setEngineKey: vi.fn(),
}));

vi.mock('@/lib/api/ai', () => ai);
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/app/(dashboard)/ia/UsageFinOps', () => ({ UsageFinOps: () => null }));
vi.mock('@/components/ai/SpendCapCard', () => ({ SpendCapCard: () => null }));

import IAPage from '@/app/(dashboard)/ia/page';

const engine = (over: Record<string, unknown>) => ({
  id: 'e1', name: 'Claude', provider: 'anthropic', type: 'api', vision: false, kind: 'anthropic',
  active: true, hasOwnKey: false, relayAvailable: false, local: false, ready: false, ...over,
});

describe('IAPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ai.getSystemPrompt.mockResolvedValue({ prompt: 'Sos el asistente de mi negocio' });
    ai.getEngines.mockResolvedValue({ activeEngineId: 'e1', engines: [engine({ hasOwnKey: true })] });
  });

  describe('M6: prompt de sistema', () => {
    it('si la carga falla bloquea "Guardar" y ofrece Reintentar (no pisa el prompt real con vacío)', async () => {
      ai.getSystemPrompt.mockRejectedValueOnce(new Error('timeout'));
      render(<IAPage />);
      expect(await screen.findByText(/No se pudo cargar el prompt guardado \(timeout\)/)).toBeInTheDocument();
      const guardar = screen.getByRole('button', { name: 'Guardar' });
      expect(guardar).toBeDisabled();
      fireEvent.click(guardar);
      expect(ai.saveSystemPrompt).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: /Reintentar/ }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled());
      expect(screen.getByDisplayValue('Sos el asistente de mi negocio')).toBeInTheDocument();
    });

    it('con el prompt cargado se guarda normalmente', async () => {
      ai.saveSystemPrompt.mockResolvedValue({ prompt: 'x' });
      render(<IAPage />);
      await screen.findByDisplayValue('Sos el asistente de mi negocio');
      await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
      await waitFor(() => expect(ai.saveSystemPrompt).toHaveBeenCalledWith('Sos el asistente de mi negocio'));
    });
  });

  describe('M3: chat de prueba', () => {
    it('reenvía el conversationId de la primera respuesta (una sola conversación en la bandeja)', async () => {
      ai.sendChatMessage
        .mockResolvedValueOnce({ text: 'Hola!', intent: 'GENERAL', actions: [], conversationId: 'conv_1' })
        .mockResolvedValueOnce({ text: 'Sí, hay turno', intent: 'BOOKING', actions: [], conversationId: 'conv_1' });
      render(<IAPage />);
      const input = await screen.findByPlaceholderText('Escribí un mensaje de prueba...');

      fireEvent.change(input, { target: { value: 'hola' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await screen.findByText('Hola!');
      expect(ai.sendChatMessage.mock.calls[0][2]).toBeUndefined();

      fireEvent.change(input, { target: { value: '¿hay turno?' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await screen.findByText('Sí, hay turno');
      expect(ai.sendChatMessage.mock.calls[1][2]).toBe('conv_1');
    });

    it('manda como máximo los últimos 20 turnos de historial (tope del server)', async () => {
      ai.sendChatMessage.mockImplementation(async () => ({ text: 'ok', intent: 'GENERAL', actions: [], conversationId: 'c' }));
      render(<IAPage />);
      const input = await screen.findByPlaceholderText('Escribí un mensaje de prueba...');
      for (let i = 0; i < 12; i++) {
        fireEvent.change(input, { target: { value: `m${i}` } });
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(ai.sendChatMessage).toHaveBeenCalledTimes(i + 1));
        await waitFor(() => expect(screen.getAllByText('ok')).toHaveLength(i + 1));
      }
      const lastHistory = ai.sendChatMessage.mock.calls[11][1];
      expect(lastHistory).toHaveLength(20);
    });
  });

  describe('A4: API keys', () => {
    async function abrirKeys() {
      render(<IAPage />);
      fireEvent.click(await screen.findByRole('button', { name: /API Keys/ }));
    }

    it('"Quitar key" pide confirmación y manda apiKey vacío', async () => {
      ai.setEngineKey.mockResolvedValue({ success: true });
      await abrirKeys();
      fireEvent.click(await screen.findByRole('button', { name: /Quitar key de Anthropic/ }));
      expect(ai.setEngineKey).not.toHaveBeenCalled();
      fireEvent.click(within_dialog());
      await waitFor(() => expect(ai.setEngineKey).toHaveBeenCalledWith('anthropic', ''));
    });

    it('cancelar la confirmación no borra nada', async () => {
      await abrirKeys();
      fireEvent.click(await screen.findByRole('button', { name: /Quitar key de Anthropic/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
      expect(ai.setEngineKey).not.toHaveBeenCalled();
    });

    it('no ofrece "Quitar key" si el proveedor no tiene key propia', async () => {
      ai.getEngines.mockResolvedValue({ activeEngineId: 'e1', engines: [engine({ hasOwnKey: false })] });
      await abrirKeys();
      await screen.findByText('Anthropic (Claude)');
      expect(screen.queryByRole('button', { name: /Quitar key/ })).toBeNull();
    });

    it('un motor local no muestra "Key OK"', async () => {
      ai.getEngines.mockResolvedValue({
        activeEngineId: 'e1',
        engines: [engine({ id: 'ollama-local', name: 'Ollama Local', provider: 'ollama', type: 'local', local: true, ready: true, active: false })],
      });
      render(<IAPage />);
      await screen.findByText('Ollama Local');
      expect(screen.queryByText('Key OK')).toBeNull();
      expect(screen.getByText('Sin key (tu servidor)')).toBeInTheDocument();
    });
  });
});

/** Botón de confirmar dentro del ConfirmDialog (alertdialog). */
function within_dialog(): HTMLElement {
  const dialog = screen.getByRole('alertdialog');
  return Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Quitar key') as HTMLElement;
}
