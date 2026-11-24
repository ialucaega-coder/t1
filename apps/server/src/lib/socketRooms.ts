/**
 * Rooms de Socket.IO. Depende solo de `lib/socket` para que lo usen tanto el handshake
 * (`lib/socketAuth.ts`) como la revocación de sesiones sin crear ciclos de imports.
 */
import { getIO } from './socket';

/** Room del negocio: todos los eventos en vivo del tenant. */
export function businessRoom(businessId: string): string {
  return `business:${businessId}`;
}

/** Room de UN usuario (en su negocio): sirve para cortar sus sockets al revocarle la sesión. */
export function userRoom(businessId: string, userId: string): string {
  return `user:${businessId}:${userId}`;
}

/**
 * Corta TODOS los sockets de un usuario (en todas las instancias si hay adaptador
 * Redis). Se llama al revocar sus sesiones; si vuelve a conectarse, el handshake
 * revalida la sesión. Nunca lanza.
 */
export function disconnectUserSockets(businessId: string, userId: string): void {
  try {
    getIO()?.in(userRoom(businessId, userId)).disconnectSockets(true);
  } catch (err) {
    console.error('No se pudieron desconectar los sockets del usuario:', (err as Error).message);
  }
}
