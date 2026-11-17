'use client';

import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') || 'http://localhost:4000';

// Transports de Socket.IO. Por defecto websocket con fallback a long-polling. Con
// VARIAS instancias del server detrás de un balanceador SIN sticky sessions, el
// long-polling falla (cada request puede caer en otra instancia y el handshake se
// rompe): en ese despliegue fijá NEXT_PUBLIC_SOCKET_TRANSPORTS=websocket (o activá
// session affinity en el balanceador). Se resuelve en build (NEXT_PUBLIC_*).
const SOCKET_TRANSPORTS = (process.env.NEXT_PUBLIC_SOCKET_TRANSPORTS || 'websocket,polling')
  .split(',')
  .map((t) => t.trim())
  .filter((t) => t === 'websocket' || t === 'polling');

let globalSocket: Socket | null = null;

// Avisa a los `useSocketEvent` que se montaron ANTES de que exista el socket (p. ej.
// mientras `business.id` todavía es null y `useSocket` no creó la conexión) para que
// se suscriban en cuanto aparece.
const socketReadyListeners = new Set<() => void>();

function getSocket(): Socket {
  if (!globalSocket) {
    globalSocket = io(SOCKET_URL, {
      transports: SOCKET_TRANSPORTS.length > 0 ? SOCKET_TRANSPORTS : ['websocket', 'polling'],
      autoConnect: true,
      // El server exige el JWT en el handshake y deriva el negocio del token
      // (no confía en el businessId que mande el cliente). Usamos la forma
      // función para enviar SIEMPRE el token vigente en cada (re)conexión.
      auth: (cb: (data: { token: string | null }) => void) => {
        let token: string | null = null;
        try {
          token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
        } catch {
          token = null;
        }
        cb({ token });
      },
    });
    socketReadyListeners.forEach((notify) => notify());
  }
  return globalSocket;
}

export function useSocket(businessId: string | null) {
  const [connected, setConnected] = useState(false);
  const [socketState, setSocketState] = useState<Socket | null>(null);

  useEffect(() => {
    if (!businessId) return;

    const socket = getSocket();
    setSocketState(socket);

    function onConnect() {
      setConnected(true);
      socket.emit('join-business', businessId);
    }

    function onDisconnect() {
      setConnected(false);
    }

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    if (socket.connected) {
      onConnect();
    } else {
      socket.connect();
    }

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [businessId]);

  return { socket: socketState, connected };
}

export function useSocketEvent<T = unknown>(
  eventName: string,
  callback: (data: T) => void,
  deps: unknown[] = []
) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    function handler(data: T) {
      callbackRef.current(data);
    }

    let subscribed: Socket | null = null;
    function attach(socket: Socket) {
      subscribed = socket;
      socket.on(eventName, handler);
    }

    // Si el socket todavía no existe (el negocio no cargó), esperamos a que se cree
    // en vez de quedarnos sin suscripción para siempre.
    let onReady: (() => void) | null = null;
    if (globalSocket) {
      attach(globalSocket);
    } else {
      onReady = () => {
        if (!globalSocket) return;
        if (onReady) socketReadyListeners.delete(onReady);
        onReady = null;
        attach(globalSocket);
      };
      socketReadyListeners.add(onReady);
    }

    return () => {
      if (onReady) socketReadyListeners.delete(onReady);
      if (subscribed) subscribed.off(eventName, handler);
    };
    // `deps` is a caller-supplied dependency array (mirrors useEffect's own
    // API), so ESLint cannot statically verify its contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventName, ...deps]);
}
