/**
 * Inbox (`/conversaciones`): botones "Tomar conversación" / "Devolver al bot" con
 * estado visible ("Atendida por <nombre>" / "Bot activo"), y marca de entrega
 * fallida de una respuesta humana con opción de reintentar.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const toast = vi.fn();
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ toast }) }));
let authRole = 'ADMIN';
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ business: { id: 'biz_1' }, user: { id: 'user_1', role: authRole } }) }));
vi.mock('@/hooks/use-socket', () => ({ useSocket: () => ({ connected: true }), useSocketEvent: () => {} }));

const refetch = vi.fn();
const refetchDetail = vi.fn();
let detailState: Record<string, unknown>;
vi.mock('@/hooks/use-conversations', () => ({
  useConversations: () => ({
    conversations: [
      { id: 'c1', status: 'OPEN', channel: 'WHATSAPP', contactName: 'Cliente Uno', contactPhone: '+549', contactEmail: null, metadata: null, createdAt: '2026-01-01T10:00:00Z', updatedAt: '2026-01-01T10:00:00Z', messages: [] },
    ],
    total: 1, isLoading: false, isLoadingMore: false, hasMore: false, loadMore: vi.fn(), error: null, refetch, closeConversation: vi.fn(),
  }),
  useConversationDetail: (id: string | null) => ({
    detail: id ? detailState : null,
    isLoading: false, refetchDetail, hasMoreMessages: false, isLoadingOlder: false, loadOlder: vi.fn(), prependCount: 0,
  }),
}));

const api = vi.hoisted(() => ({
  take: vi.fn(), release: vi.fn(), markRead: vi.fn(), reply: vi.fn(), retryReply: vi.fn(),
}));
vi.mock('@/lib/api/conversations', () => api);
vi.mock('@/lib/api/team', () => ({ getMembers: vi.fn(async () => []) }));

import ConversacionesPage from '@/app/(dashboard)/conversaciones/page';

Element.prototype.scrollIntoView = vi.fn();

function baseDetail(over: Record<string, unknown> = {}) {
  return {
    id: 'c1', status: 'OPEN', channel: 'WHATSAPP', contactName: 'Cliente Uno', contactPhone: '+549', contactEmail: null,
    metadata: null, createdAt: '2026-01-01T10:00:00Z', updatedAt: '2026-01-01T10:00:00Z', messages: [], ...over,
  };
}

async function openConversation() {
  render(<ConversacionesPage />);
  fireEvent.click(await screen.findByText('Cliente Uno'));
  await waitFor(() => expect(api.markRead).toHaveBeenCalled());
}

beforeEach(() => {
  vi.clearAllMocks();
  api.markRead.mockResolvedValue({ metadata: {} });
  detailState = baseDetail();
  authRole = 'ADMIN';
});

describe('inbox — tomar / devolver al bot', () => {
  it('con el bot activo muestra "Bot activo" y "Tomar conversación", que llama a take', async () => {
    api.take.mockResolvedValue({ metadata: { botPaused: true } });
    await openConversation();

    expect(screen.getByText('Bot activo')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Tomar conversación/ }));

    await waitFor(() => expect(api.take).toHaveBeenCalledWith('c1'));
    expect(api.release).not.toHaveBeenCalled();
    expect(refetchDetail).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('con el bot pausado muestra "Atendida por <nombre>" y "Devolver al bot", que llama a release', async () => {
    detailState = baseDetail({ metadata: { botPaused: true, pausedBy: 'user_1', pausedByName: 'Ana Agente' } });
    api.release.mockResolvedValue({ metadata: { botPaused: false } });
    await openConversation();

    expect(screen.getByText(/Atendida por Ana Agente/)).toBeTruthy();
    expect(screen.queryByText('Bot activo')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Devolver al bot/ }));

    await waitFor(() => expect(api.release).toHaveBeenCalledWith('c1'));
    expect(api.take).not.toHaveBeenCalled();
  });

  it('si take falla muestra un error y no refresca como si hubiera funcionado', async () => {
    api.take.mockRejectedValue(new Error('boom'));
    await openConversation();

    fireEvent.click(screen.getByRole('button', { name: /Tomar conversación/ }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: expect.stringContaining('No se pudo tomar la conversación.') })));
    expect(refetchDetail).not.toHaveBeenCalled();
  });

  it('derivada y sin tomar (HANDOFF) muestra "Esperando agente" y permite tomar o devolver al bot', async () => {
    detailState = baseDetail({ status: 'HANDOFF', metadata: { waitingSince: '2026-01-01T10:00:00Z' } });
    await openConversation();

    expect(screen.getByText('Esperando agente')).toBeTruthy();
    expect(screen.queryByText('Bot activo')).toBeNull();
    expect(screen.getByRole('button', { name: /Tomar conversación/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Devolver al bot/ })).toBeTruthy();
  });

  it('si la tiene OTRO agente, un ADMIN ve "Tomar igual" y fuerza el take', async () => {
    detailState = baseDetail({ metadata: { botPaused: true, pausedBy: 'user_9', pausedByName: 'Beto' } });
    api.take.mockResolvedValue({ metadata: { botPaused: true } });
    await openConversation();

    expect(screen.getByText(/Atendida por Beto/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Tomar conversación/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Tomar igual/ }));

    await waitFor(() => expect(api.take).toHaveBeenCalledWith('c1', true));
  });

  it('si la tiene OTRO agente, un no-admin no ve "Tomar igual"', async () => {
    authRole = 'PROFESSIONAL';
    detailState = baseDetail({ metadata: { botPaused: true, pausedBy: 'user_9', pausedByName: 'Beto' } });
    await openConversation();

    expect(screen.queryByRole('button', { name: /Tomar igual/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Devolver al bot/ })).toBeTruthy();
  });

  it('si el server rechaza el take (409), el toast muestra el motivo', async () => {
    api.take.mockRejectedValue(new Error('Ya la está atendiendo Beto.'));
    await openConversation();

    fireEvent.click(screen.getByRole('button', { name: /Tomar conversación/ }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
      message: 'No se pudo tomar la conversación. Ya la está atendiendo Beto.',
    })));
  });

  it('en una conversación cerrada no ofrece tomar ni devolver', async () => {
    detailState = baseDetail({ status: 'CLOSED' });
    await openConversation();

    expect(screen.queryByRole('button', { name: /Tomar conversación/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Devolver al bot/ })).toBeNull();
  });
});

describe('inbox — entrega fallida de una respuesta humana', () => {
  const failedMsg = {
    id: 'm1', role: 'BOT', text: 'Hola, te ayudo', responseTime: null, createdAt: '2026-01-01T10:05:00Z',
    metadata: { sender: 'human', deliveryStatus: 'failed', deliveryError: 'Pasaron más de 24 h desde el último mensaje del cliente' },
  };

  it('marca "No se pudo enviar al cliente" con el motivo y permite reintentar', async () => {
    detailState = baseDetail({ messages: [failedMsg] });
    api.retryReply.mockResolvedValue({ id: 'm1', deliveryStatus: 'sent' });
    await openConversation();

    expect(screen.getByText('No se pudo enviar al cliente')).toBeTruthy();
    expect(screen.getByText(/Pasaron más de 24 h/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    await waitFor(() => expect(api.retryReply).toHaveBeenCalledWith('c1', 'm1'));
  });

  it('un mensaje enviado bien no muestra la marca de fallo', async () => {
    detailState = baseDetail({ messages: [{ ...failedMsg, metadata: { sender: 'human', deliveryStatus: 'sent' } }] });
    await openConversation();

    expect(screen.queryByText('No se pudo enviar al cliente')).toBeNull();
  });
});
