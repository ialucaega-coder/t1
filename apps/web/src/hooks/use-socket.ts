'use client';

import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') || 'http://localhost:4000';

let globalSocket: Socket | null = null;

function getSocket(): Socket {
  if (!globalSocket) {
    globalSocket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
    });
  }
  return globalSocket;
}

export function useSocket(businessId: string | null) {
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!businessId) return;

    const socket = getSocket();
    socketRef.current = socket;

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

  return { socket: socketRef.current, connected };
}

export function useSocketEvent<T = unknown>(
  eventName: string,
  callback: (data: T) => void,
  deps: unknown[] = []
) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const socket = globalSocket;
    if (!socket) return;

    function handler(data: T) {
      callbackRef.current(data);
    }

    socket.on(eventName, handler);
    return () => { socket.off(eventName, handler); };
    // `deps` is a caller-supplied dependency array (mirrors useEffect's own
    // API), so ESLint cannot statically verify its contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventName, ...deps]);
}
