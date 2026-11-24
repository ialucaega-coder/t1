/**
 * Handshake de Socket.IO (lib/socketAuth.ts): JWT válido, rol de staff, sesión no
 * revocada y negocio derivado del token; rooms; y corte de sockets al revocar sesiones.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

vi.mock('../../services/auth/revocation', () => ({ isSessionRevoked: vi.fn(async () => false) }));

import { isSessionRevoked } from '../../services/auth/revocation';
import { socketAuthMiddleware, registerSocketConnection } from '../../lib/socketAuth';
import { disconnectUserSockets, businessRoom, userRoom } from '../../lib/socketRooms';
import { initSocket } from '../../lib/socket';

const SECRET = process.env.NEXTAUTH_SECRET || 'test-secret';
const sign = (over: Record<string, unknown> = {}) =>
  jwt.sign({ userId: 'u1', businessId: 'biz_1', role: 'PROFESSIONAL', ...over }, SECRET);

function fakeSocket(auth: Record<string, unknown> = {}, headers: Record<string, unknown> = {}) {
  const handlers: Record<string, () => void> = {};
  return {
    handshake: { auth, headers },
    data: {} as Record<string, unknown>,
    join: vi.fn(),
    on: vi.fn((ev: string, fn: () => void) => { handlers[ev] = fn; }),
    handlers,
  };
}

async function handshake(socket: ReturnType<typeof fakeSocket>) {
  const next = vi.fn();
  await socketAuthMiddleware(socket as never, next);
  return next;
}

beforeEach(() => {
  vi.clearAllMocks();
  (isSessionRevoked as ReturnType<typeof vi.fn>).mockResolvedValue(false);
});

describe('socketAuthMiddleware', () => {
  it('sin token: unauthorized', async () => {
    const next = await handshake(fakeSocket());
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'unauthorized' }));
  });

  it('token inválido o vencido: unauthorized', async () => {
    const next = await handshake(fakeSocket({ token: 'basura' }));
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'unauthorized' }));
  });

  it('staff con sesión vigente: pasa y guarda negocio, usuario y rol del TOKEN', async () => {
    const socket = fakeSocket({ token: sign({ role: 'ADMIN' }) });
    const next = await handshake(socket);

    expect(next).toHaveBeenCalledWith();
    expect(socket.data).toMatchObject({ businessId: 'biz_1', userId: 'u1', role: 'ADMIN' });
  });

  it('también acepta el token por el header x-auth-token', async () => {
    const socket = fakeSocket({}, { 'x-auth-token': sign() });
    expect(await handshake(socket)).toHaveBeenCalledWith();
  });

  it('un CLIENT (VIEWER) con JWT válido NO entra: no recibe eventos del negocio', async () => {
    const socket = fakeSocket({ token: sign({ role: 'CLIENT' }) });
    const next = await handshake(socket);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'forbidden' }));
    expect(socket.data.businessId).toBeUndefined();
  });

  it('un token sin rol o con un rol desconocido tampoco entra', async () => {
    for (const role of [undefined, 'SUPERUSER']) {
      const next = await handshake(fakeSocket({ token: sign({ role }) }));
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'forbidden' }));
    }
  });

  it('una sesión revocada (empleado dado de baja) no se reconecta', async () => {
    (isSessionRevoked as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const next = await handshake(fakeSocket({ token: sign() }));

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'unauthorized' }));
  });

  it('la revocación se consulta con negocio, usuario e iat del token', async () => {
    await handshake(fakeSocket({ token: sign() }));

    const [biz, user, iat] = (isSessionRevoked as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(biz).toBe('biz_1');
    expect(user).toBe('u1');
    expect(typeof iat).toBe('number');
  });

  it('un token sin userId o sin businessId es inválido', async () => {
    expect(await handshake(fakeSocket({ token: sign({ userId: undefined }) }))).toHaveBeenCalledWith(expect.any(Error));
    expect(await handshake(fakeSocket({ token: sign({ businessId: undefined }) }))).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('registerSocketConnection', () => {
  it('une al socket SOLO a la room de su negocio y a la suya; join-business no cambia de tenant', () => {
    const socket = fakeSocket();
    socket.data = { businessId: 'biz_1', userId: 'u1' };

    registerSocketConnection(socket as never);
    socket.handlers['join-business']();

    const joined = socket.join.mock.calls.map((c) => c[0]);
    expect(joined).toContain(businessRoom('biz_1'));
    expect(joined).toContain(userRoom('biz_1', 'u1'));
    expect(joined.every((r: string) => r.includes('biz_1'))).toBe(true);
  });
});

describe('disconnectUserSockets', () => {
  it('corta los sockets de la room del usuario (disconnectSockets(true))', () => {
    const disconnectSockets = vi.fn();
    const inFn = vi.fn(() => ({ disconnectSockets }));
    initSocket({ in: inFn } as never);

    disconnectUserSockets('biz_1', 'u1');

    expect(inFn).toHaveBeenCalledWith('user:biz_1:u1');
    expect(disconnectSockets).toHaveBeenCalledWith(true);
  });

  it('nunca lanza (sin io o con un error del adaptador)', () => {
    initSocket(undefined as never);
    expect(() => disconnectUserSockets('biz_1', 'u1')).not.toThrow();

    initSocket({ in: () => { throw new Error('redis caído'); } } as never);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => disconnectUserSockets('biz_1', 'u1')).not.toThrow();
    err.mockRestore();
  });
});
