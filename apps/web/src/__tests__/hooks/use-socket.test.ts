/**
 * useSocketEvent: si el socket todavía no existe al montar (business.id null → useSocket
 * no creó la conexión), debe suscribirse apenas aparezca en vez de quedar sordo.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

type Handler = (data: unknown) => void;

function makeFakeSocket() {
  const handlers = new Map<string, Set<Handler>>();
  return {
    connected: false,
    on: vi.fn((ev: string, h: Handler) => {
      if (!handlers.has(ev)) handlers.set(ev, new Set());
      handlers.get(ev)!.add(h);
    }),
    off: vi.fn((ev: string, h: Handler) => { handlers.get(ev)?.delete(h); }),
    emit: vi.fn(),
    connect: vi.fn(),
    trigger(ev: string, data?: unknown) { handlers.get(ev)?.forEach((h) => h(data)); },
    count(ev: string) { return handlers.get(ev)?.size ?? 0; },
  };
}

let fake: ReturnType<typeof makeFakeSocket>;
const io = vi.fn(() => fake);
vi.mock('socket.io-client', () => ({ io: (...a: unknown[]) => (io as (...x: unknown[]) => unknown)(...a) }));

beforeEach(() => {
  vi.resetModules();
  io.mockClear();
  fake = makeFakeSocket();
});

async function load() {
  return await import('@/hooks/use-socket');
}

describe('hooks/use-socket: useSocketEvent', () => {
  it('se suscribe cuando el socket se crea DESPUÉS de montar el listener', async () => {
    const { useSocket, useSocketEvent } = await load();
    const cb = vi.fn();

    // 1) Se monta el listener sin negocio todavía (no hay socket).
    renderHook(() => useSocketEvent('campaign:sent', cb));
    expect(io).not.toHaveBeenCalled();
    expect(fake.count('campaign:sent')).toBe(0);

    // 2) Llega business.id: useSocket crea el socket.
    renderHook(() => useSocket('biz_1'));
    expect(io).toHaveBeenCalledTimes(1);

    // 3) El listener ya quedó suscripto y recibe eventos.
    expect(fake.count('campaign:sent')).toBe(1);
    act(() => fake.trigger('campaign:sent', { id: 'c1' }));
    expect(cb).toHaveBeenCalledWith({ id: 'c1' });
  });

  it('si el socket ya existe, se suscribe de inmediato y se desuscribe al desmontar', async () => {
    const { useSocket, useSocketEvent } = await load();
    renderHook(() => useSocket('biz_1'));
    const cb = vi.fn();
    const { unmount } = renderHook(() => useSocketEvent('x', cb));
    expect(fake.count('x')).toBe(1);
    unmount();
    expect(fake.count('x')).toBe(0);
  });

  it('desmontar antes de que exista el socket no deja suscripciones colgadas', async () => {
    const { useSocket, useSocketEvent } = await load();
    const cb = vi.fn();
    const { unmount } = renderHook(() => useSocketEvent('y', cb));
    unmount();
    renderHook(() => useSocket('biz_1'));
    expect(fake.count('y')).toBe(0);
  });

  it('useSocket expone el socket como estado cuando se crea', async () => {
    const { useSocket } = await load();
    const { result } = renderHook(() => useSocket('biz_1'));
    expect(result.current.socket).toBe(fake);
  });
});
