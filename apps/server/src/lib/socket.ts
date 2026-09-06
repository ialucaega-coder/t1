import { Server } from 'socket.io';

let io: Server;

export function initSocket(server: Server) {
  io = server;
}

export function getIO(): Server {
  return io;
}
