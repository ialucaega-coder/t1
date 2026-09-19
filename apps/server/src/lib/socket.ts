import { Server } from 'socket.io';

let io: Server | undefined;

export function initSocket(server: Server) {
  io = server;
}

/**
 * Devuelve la instancia de Socket.IO, o `undefined` si el servidor todavía
 * no la inicializó (por ejemplo, en tests que montan la app Express sin
 * levantar el servidor HTTP/socket real).
 */
export function getIO(): Server | undefined {
  return io;
}
