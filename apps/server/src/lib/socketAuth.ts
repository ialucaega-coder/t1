/**
 * Autenticación del handshake de Socket.IO.
 *
 * Los eventos en vivo del negocio (mensajes de clientes, reservas con PII,
 * campañas) son del PANEL: solo los puede recibir staff con una sesión vigente.
 *  - Se exige el JWT en `handshake.auth.token` y se deriva el negocio del token
 *    (nunca de lo que mande el cliente).
 *  - Rol de staff (ADMIN / PROFESSIONAL): un CLIENT (p. ej. un VIEWER de portal)
 *    tiene un JWT válido pero NO debe escuchar el tráfico del negocio.
 *  - Sesión no revocada (`isSessionRevoked`): un empleado dado de baja, o con la
 *    contraseña cambiada, no se reconecta con un token viejo.
 * Un socket ya conectado se corta cuando se revocan las sesiones del usuario
 * (`disconnectUserSockets` de lib/socketRooms.ts, llamado desde `revokeUserSessions`).
 */
import jwt from 'jsonwebtoken';
import type { Server, Socket } from 'socket.io';
import { getAuthSecret } from './secrets';
import { businessRoom, userRoom } from './socketRooms';
import { STAFF_ROLES } from '../middleware/auth';
import { isSessionRevoked } from '../services/auth/revocation';

interface SocketJwt {
  userId?: string;
  businessId?: string;
  role?: string;
  iat?: number;
}

/** Middleware de `io.use`: valida token, rol de staff y sesión vigente. */
export async function socketAuthMiddleware(socket: Socket, next: (err?: Error) => void): Promise<void> {
  try {
    const token = (socket.handshake.auth?.token || socket.handshake.headers?.['x-auth-token']) as string | undefined;
    if (!token) return next(new Error('unauthorized'));

    const payload = jwt.verify(token, getAuthSecret()) as SocketJwt;
    if (!payload?.businessId || !payload.userId) return next(new Error('unauthorized'));
    if (!payload.role || !(STAFF_ROLES as readonly string[]).includes(payload.role)) return next(new Error('forbidden'));
    if (await isSessionRevoked(payload.businessId, payload.userId, payload.iat)) return next(new Error('unauthorized'));

    socket.data.businessId = payload.businessId;
    socket.data.userId = payload.userId;
    socket.data.role = payload.role;
    next();
  } catch {
    next(new Error('unauthorized'));
  }
}

/** Une el socket autenticado a la room de SU negocio y a la suya propia. */
export function registerSocketConnection(socket: Socket): void {
  const businessId = socket.data.businessId as string;
  const userId = socket.data.userId as string;
  socket.join(businessRoom(businessId));
  socket.join(userRoom(businessId, userId));

  // Compatibilidad: si el cliente emite 'join-business', ignoramos el argumento
  // y usamos siempre el negocio del token (no se puede saltar a otro tenant).
  socket.on('join-business', () => {
    socket.join(businessRoom(businessId));
  });
}

/** Instala el handshake y las rooms en el servidor de Socket.IO. */
export function setupSocketAuth(io: Server): void {
  io.use((socket, next) => {
    void socketAuthMiddleware(socket, next);
  });
  io.on('connection', registerSocketConnection);
}
