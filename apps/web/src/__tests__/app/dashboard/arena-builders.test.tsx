/**
 * Arena: editar y borrar builders (con ConfirmDialog y errores reales) y el chat de
 * prueba manda el builderId elegido.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const toast = vi.fn();
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/stores/page-counter', () => ({ usePageCounter: () => {}, fmtCounter: () => '' }));

const sendChat = vi.fn();
const updateBuilder = vi.fn();
const deleteBuilder = vi.fn();

const builder = (over: Record<string, unknown>) => ({
  id: 'b1', name: 'Juan', title: 'Agente express', description: 'Reserva rápido', systemPrompt: 'Sé breve',
  model: 'claude-sonnet-5', temperature: 0.7, status: 'ACTIVE', rank: 1, votes: 3, businessId: 'biz', createdAt: '', updatedAt: '', ...over,
});
let builders: Record<string, unknown>[] = [];

vi.mock('@/hooks/use-arena', () => ({
  useArena: () => ({
    builders, ideas: [], isLoading: false, error: null, refetch: vi.fn(),
    voteBuilder: vi.fn(), voteIdea: vi.fn(), createBuilder: vi.fn(), createIdea: vi.fn(),
    updateBuilder, deleteBuilder, sendChat,
  }),
}));

import ArenaPage from '@/app/(dashboard)/arena/page';

Element.prototype.scrollIntoView = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  builders = [builder({}), builder({ id: 'b2', title: 'Otro bot', name: 'Ana', rank: 5 })];
  updateBuilder.mockResolvedValue(undefined);
  deleteBuilder.mockResolvedValue(undefined);
  sendChat.mockResolvedValue({ reply: 'ok', conversationId: 'c1' });
});

function goToBuilders() {
  render(<ArenaPage />);
  fireEvent.click(screen.getByRole('button', { name: /Builders/ }));
}

describe('arena: editar builder', () => {
  it('abre el formulario con los datos actuales y guarda con updateBuilder (sin tocar el modelo)', async () => {
    goToBuilders();
    fireEvent.click(screen.getByRole('button', { name: 'Editar Agente express' }));

    expect(await screen.findByDisplayValue('Agente express')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Sé breve')).toBeInTheDocument();
    expect(screen.getByText('Editar contribución')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('Agente express'), { target: { value: 'Agente v2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(updateBuilder).toHaveBeenCalledWith('b1', {
      name: 'Juan', title: 'Agente v2', description: 'Reserva rápido', systemPrompt: 'Sé breve',
    }));
    expect(toast).toHaveBeenCalledWith({ type: 'success', message: 'Contribución actualizada' });
  });

  it('si el server rechaza (no admin) muestra un mensaje claro y no cierra el formulario', async () => {
    updateBuilder.mockRejectedValue(new Error('Insufficient permissions'));
    goToBuilders();
    fireEvent.click(screen.getByRole('button', { name: 'Editar Agente express' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith({ type: 'error', message: 'Solo un administrador puede hacer esto' }));
    expect(screen.getByText('Editar contribución')).toBeInTheDocument();
  });
});

describe('arena: borrar builder', () => {
  it('pide confirmación y recién al confirmar borra', async () => {
    goToBuilders();
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Agente express' }));

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(deleteBuilder).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(deleteBuilder).toHaveBeenCalledWith('b1'));
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ type: 'success', message: 'Contribución eliminada' }));
  });

  it('cancelar el diálogo no borra nada', async () => {
    goToBuilders();
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Agente express' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(deleteBuilder).not.toHaveBeenCalled();
  });

  it('si el borrado falla muestra el error real', async () => {
    deleteBuilder.mockRejectedValue(new Error('Builder not found'));
    goToBuilders();
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Agente express' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ type: 'error', message: 'Builder not found' }));
  });
});

describe('arena: el chat manda el builderId seleccionado', () => {
  async function send(text: string) {
    const input = screen.getByPlaceholderText('Escribe un mensaje para probar...');
    fireEvent.change(input, { target: { value: text } });
    fireEvent.keyDown(input, { key: 'Enter' });
  }

  it('sin builder elegido no manda builderId', async () => {
    render(<ArenaPage />);
    await send('hola');
    await waitFor(() => expect(sendChat).toHaveBeenCalledTimes(1));
    expect(sendChat).toHaveBeenLastCalledWith('hola', undefined);
  });

  it('con un builder elegido lo manda como tercer argumento', async () => {
    render(<ArenaPage />);
    fireEvent.change(screen.getByLabelText('PROBAR CON'), { target: { value: 'b2' } });
    await send('hola');
    await waitFor(() => expect(sendChat).toHaveBeenCalledTimes(1));
    expect(sendChat).toHaveBeenLastCalledWith('hola', undefined, 'b2');
  });

  it('al cambiar de builder empieza una conversación nueva (no reusa el conversationId)', async () => {
    render(<ArenaPage />);
    await send('uno');
    await waitFor(() => expect(sendChat).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('PROBAR CON'), { target: { value: 'b1' } });
    await send('dos');
    await waitFor(() => expect(sendChat).toHaveBeenCalledTimes(2));
    expect(sendChat).toHaveBeenLastCalledWith('dos', undefined, 'b1');
  });
});
