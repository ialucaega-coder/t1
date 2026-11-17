/**
 * Pruebas de la pantalla Arena (`/arena`): "Probar bot" muestra la respuesta
 * real del bot (campo `reply`), un error real NO se disfraza de respuesta del
 * bot, el podio no incluye contribuciones nuevas (rank > 3) y el voto de ideas
 * maneja el rechazo con un toast.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const toast = vi.fn();
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/stores/page-counter', () => ({ usePageCounter: () => {}, fmtCounter: () => '' }));

const sendChat = vi.fn();
const voteIdea = vi.fn();
let arenaState: Record<string, unknown>;
vi.mock('@/hooks/use-arena', () => ({
  useArena: () => ({
    builders: [],
    ideas: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    voteBuilder: vi.fn(),
    createBuilder: vi.fn(),
    createIdea: vi.fn(),
    sendChat,
    voteIdea,
    ...arenaState,
  }),
}));

import ArenaPage from '@/app/(dashboard)/arena/page';

// jsdom no implementa scrollIntoView.
Element.prototype.scrollIntoView = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  arenaState = {};
});

async function sendMessage(text: string) {
  fireEvent.change(screen.getByPlaceholderText('Escribe un mensaje para probar...'), { target: { value: text } });
  fireEvent.keyDown(screen.getByPlaceholderText('Escribe un mensaje para probar...'), { key: 'Enter' });
}

describe('arena page', () => {
  it('muestra la respuesta real del bot (reply) y reenvía el conversationId', async () => {
    sendChat.mockResolvedValueOnce({ reply: 'Abrimos de 9 a 18', conversationId: 'c1' });
    render(<ArenaPage />);

    await sendMessage('¿horarios?');
    expect(await screen.findByText('Abrimos de 9 a 18')).toBeTruthy();
    expect(sendChat).toHaveBeenLastCalledWith('¿horarios?', undefined);

    await sendMessage('gracias');
    await waitFor(() => expect(sendChat).toHaveBeenCalledTimes(2));
    expect(sendChat).toHaveBeenLastCalledWith('gracias', 'c1');
  });

  it('si falla el request muestra el error real y NO una respuesta fabricada', async () => {
    sendChat.mockRejectedValueOnce(new Error('Network error'));
    render(<ArenaPage />);

    await sendMessage('hola');

    expect(await screen.findByText(/No se pudo obtener la respuesta del bot: Network error/)).toBeTruthy();
    expect(screen.queryByText(/Déjame consultar eso/)).toBeNull();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  it('si el server no devuelve reply tampoco inventa una respuesta', async () => {
    sendChat.mockResolvedValueOnce({});
    render(<ArenaPage />);

    await sendMessage('hola');

    expect(await screen.findByText(/No se pudo obtener la respuesta del bot/)).toBeTruthy();
    expect(screen.queryByText(/Déjame consultar eso/)).toBeNull();
  });

  it('una contribución nueva (rank > 3) va al ranking, no al podio, y muestra su título', () => {
    arenaState = {
      builders: [
        { id: 'b1', name: 'Juan', title: 'Agente express', description: '', votes: 0, rank: 4, github: false },
        { id: 'b2', name: 'Ana', title: 'Podio real', description: '', votes: 9, rank: 1, github: true },
      ],
    };
    render(<ArenaPage />);
    fireEvent.click(screen.getByText('Builders'));

    expect(screen.getByText('Agente express')).toBeTruthy();
    expect(screen.getByText('RANKING')).toBeTruthy();
    // Solo la contribución con rank 1 está en el podio.
    expect(screen.getAllByText(/^(Podio real|Agente express)$/)).toHaveLength(2);
  });

  it('votar una idea con error del server muestra un toast (sin rechazo sin manejar)', async () => {
    arenaState = {
      ideas: [{ id: 'i1', title: 'Idea', description: 'd', category: 'x', votes: 1 }],
    };
    voteIdea.mockRejectedValueOnce(new Error('Ya votaste esta idea'));
    render(<ArenaPage />);
    fireEvent.click(screen.getByText('Ideas'));

    fireEvent.click(screen.getByText('1').closest('button')!);

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({ type: 'error', message: 'Ya votaste esta idea' })
    );
  });
});
