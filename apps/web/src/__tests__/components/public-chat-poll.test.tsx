/**
 * Chat público: el visitante ve las respuestas de una persona (polling de
 * GET /api/public/chat/:botId/messages) sin duplicados y sin romper el chat.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

import { PublicChat, POLL_INTERVAL_MS, POLL_IDLE_MS, POLL_PAGE_GAP_MS } from '@/app/(public)/chat/[botId]/PublicChat';

Element.prototype.scrollIntoView = vi.fn();

const json = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => body } as Response);

const humanMsg = {
  id: 'h1', role: 'BOT', text: 'Hola, soy Ana del equipo', createdAt: '2026-11-01T10:00:00.000Z', fromHuman: true,
};
const botMsg = {
  id: 'b1', role: 'BOT', text: 'respuesta del bot', createdAt: '2026-11-01T09:59:00.000Z', fromHuman: false,
};

let pollHandler: (url: string) => Promise<Response>;
const fetchMock = vi.fn();
const pollCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes('/messages'));

beforeEach(() => {
  vi.useFakeTimers();
  pollHandler = () => json({ messages: [] });
  fetchMock.mockReset().mockImplementation((url: string, init?: RequestInit) => {
    if (url.endsWith('/api/public/bot/bot1')) {
      return json({ id: 'bot1', name: 'Asistente', businessName: 'Local', status: 'ACTIVE' });
    }
    if (url.endsWith('/api/public/chat') && init?.method === 'POST') {
      return json({ text: 'respuesta del bot', intent: 'FAQ', actions: [], conversationId: 'c1', chatToken: 'tok_abc' });
    }
    return pollHandler(url);
  });
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
});

async function openAndSend() {
  const view = render(<PublicChat botId="bot1" />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  fireEvent.change(screen.getByPlaceholderText('Escribí un mensaje...'), { target: { value: 'hola' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  return view;
}

const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe('PublicChat: respuestas humanas', () => {
  it('muestra la respuesta de una persona con la etiqueta discreta', async () => {
    pollHandler = () => json({ messages: [botMsg, humanMsg] });
    await openAndSend();

    expect(screen.queryByText('Hola, soy Ana del equipo')).toBeNull();
    await tick(POLL_INTERVAL_MS);

    expect(screen.getByText('Hola, soy Ana del equipo')).toBeInTheDocument();
    expect(screen.getByText(/Atendido por una persona/)).toBeInTheDocument();
  });

  it('manda el token por HEADER (no en la URL) y el id de conversación, y avanza el cursor `after`', async () => {
    pollHandler = () => json({ messages: [humanMsg] });
    await openAndSend();
    await tick(POLL_INTERVAL_MS);
    await tick(POLL_INTERVAL_MS);

    const [first, second] = pollCalls().map((c) => new URL(String(c[0]), 'http://x'));
    expect(first.searchParams.get('conversationId')).toBe('c1');
    expect(first.searchParams.has('token')).toBe(false);
    expect((pollCalls()[0][1] as RequestInit).headers).toMatchObject({ 'X-Chat-Token': 'tok_abc' });
    expect(first.searchParams.get('after')).toBeNull();
    expect(second.searchParams.get('after')).toBe(humanMsg.createdAt);
  });

  it('no duplica: ni el mismo mensaje humano en polls repetidos ni la respuesta del bot que ya llegó por el POST', async () => {
    pollHandler = () => json({ messages: [botMsg, humanMsg] });
    await openAndSend();
    await tick(POLL_INTERVAL_MS);
    await tick(POLL_INTERVAL_MS);
    await tick(POLL_INTERVAL_MS);

    expect(screen.getAllByText('Hola, soy Ana del equipo')).toHaveLength(1);
    expect(screen.getAllByText('respuesta del bot')).toHaveLength(1); // la del POST
  });

  it('deja de consultar al desmontarse', async () => {
    const { unmount } = await openAndSend();
    await tick(POLL_INTERVAL_MS);
    const before = pollCalls().length;
    expect(before).toBeGreaterThan(0);

    unmount();
    await tick(POLL_INTERVAL_MS * 5);

    expect(pollCalls().length).toBe(before);
  });

  it('pausa con la pestaña oculta y reanuda al volver', async () => {
    await openAndSend();
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    await tick(POLL_INTERVAL_MS * 3);
    expect(pollCalls()).toHaveLength(0);

    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0); });
    expect(pollCalls()).toHaveLength(1);
  });

  it('si el endpoint falla el chat sigue andando y las consultas se espacian (backoff)', async () => {
    pollHandler = () => Promise.reject(new Error('red caída'));
    await openAndSend();
    await tick(POLL_INTERVAL_MS); // 1.ª consulta falla
    expect(pollCalls()).toHaveLength(1);

    await tick(POLL_INTERVAL_MS); // a los 4 s NO reintenta (backoff 8 s)
    expect(pollCalls()).toHaveLength(1);
    await tick(POLL_INTERVAL_MS); // a los 8 s sí
    expect(pollCalls()).toHaveLength(2);

    // y se puede seguir conversando
    fireEvent.change(screen.getByPlaceholderText('Escribí un mensaje...'), { target: { value: 'otra' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
    await tick(0);
    expect(screen.getAllByText('respuesta del bot').length).toBe(2);
  });

  it('con 404 (token inválido) deja de consultar para siempre', async () => {
    pollHandler = () => json({ error: 'No encontrado' }, 404);
    await openAndSend();
    await tick(POLL_INTERVAL_MS);
    await tick(POLL_INTERVAL_MS * 10);

    expect(pollCalls()).toHaveLength(1);
  });

  it('se detiene tras un rato sin actividad y se reanuda cuando el visitante escribe', async () => {
    await openAndSend();
    await tick(POLL_INTERVAL_MS);
    await tick(POLL_IDLE_MS + POLL_INTERVAL_MS * 2);
    const stopped = pollCalls().length;
    await tick(POLL_INTERVAL_MS * 5);
    expect(pollCalls().length).toBe(stopped); // dormido

    fireEvent.change(screen.getByPlaceholderText('Escribí un mensaje...'), { target: { value: 'sigo acá' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
    await tick(POLL_INTERVAL_MS);
    expect(pollCalls().length).toBeGreaterThan(stopped);
  });

  it('sin token (conversación vieja) no consulta nada', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/api/public/bot/bot1')) {
        return json({ id: 'bot1', name: 'Asistente', businessName: 'Local', status: 'ACTIVE' });
      }
      if (init?.method === 'POST') return json({ text: 'ok', intent: 'FAQ', actions: [], conversationId: 'c1' });
      return pollHandler(url);
    });
    await openAndSend();
    await tick(POLL_INTERVAL_MS * 5);

    expect(pollCalls()).toHaveLength(0);
  });

  it('el segundo mensaje del visitante manda el token en el POST para continuar la conversación', async () => {
    await openAndSend();
    fireEvent.change(screen.getByPlaceholderText('Escribí un mensaje...'), { target: { value: 'otra' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
    await tick(0);

    const posts = fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST');
    expect(posts).toHaveLength(2);
    expect((posts[0][1] as RequestInit).headers).not.toHaveProperty('X-Chat-Token'); // la primera abre la conversación
    expect((posts[1][1] as RequestInit).headers).toMatchObject({ 'X-Chat-Token': 'tok_abc' });
    expect(JSON.parse(String((posts[1][1] as RequestInit).body)).conversationId).toBe('c1');
  });

  it('con más páginas pendientes (hasMore) deja al menos 1 s entre consultas', async () => {
    pollHandler = () => json({ messages: [], hasMore: true });
    await openAndSend();
    await tick(POLL_INTERVAL_MS);
    expect(pollCalls()).toHaveLength(1);

    await tick(POLL_PAGE_GAP_MS - 100); // todavía no
    expect(pollCalls()).toHaveLength(1);
    await tick(200);
    expect(pollCalls()).toHaveLength(2);
  });

  it('si el POST devuelve texto vacío (conversación atendida por una persona) no dibuja burbuja del bot; con texto normal sí', async () => {
    await openAndSend(); // 1.ª respuesta normal: 'respuesta del bot'
    const bubbles = () => screen.queryAllByText('respuesta del bot').length;
    expect(bubbles()).toBe(1);

    const postWith = (text: string) =>
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (init?.method === 'POST') return json({ text, intent: 'FAQ', actions: [], conversationId: 'c1' });
        return pollHandler(url);
      });
    const send = async (msg: string) => {
      fireEvent.change(screen.getByPlaceholderText('Escribí un mensaje...'), { target: { value: msg } });
      fireEvent.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
      await tick(0);
    };

    postWith('');
    await send('estoy esperando');
    postWith('   ');
    await send('¿hay alguien?');

    // los mensajes del visitante se ven, pero no hubo burbujas nuevas del bot (ni en blanco)
    expect(screen.getByText('estoy esperando')).toBeInTheDocument();
    expect(screen.getByText('¿hay alguien?')).toBeInTheDocument();
    expect(bubbles()).toBe(1);
    // 3 burbujas del visitante + 1 del bot (la primera): ninguna en blanco
    expect(document.querySelectorAll('p.whitespace-pre-wrap')).toHaveLength(4);

    // con texto normal sí aparece
    postWith('Ahora te ayudo');
    await send('gracias');
    expect(screen.getByText('Ahora te ayudo')).toBeInTheDocument();
    expect(document.querySelectorAll('p.whitespace-pre-wrap')).toHaveLength(6);
  });
});
