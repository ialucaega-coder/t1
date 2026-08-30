/**
 * Pruebas unitarias para el middleware de rate limiting
 * (`src/middleware/rateLimit.ts`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { rateLimit } from '../../middleware/rateLimit';

function createMockReq(ip = '127.0.0.1'): Request {
  return {
    ip,
    socket: { remoteAddress: ip },
  } as unknown as Request;
}

function createMockRes(): Response {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

describe('middleware/rateLimit', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('permite la solicitud cuando esta por debajo del limite', () => {
    const middleware = rateLimit(3);
    const req = createMockReq('1.1.1.1');
    const res = createMockRes();
    const next = vi.fn() as unknown as NextFunction;

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('bloquea la solicitud con 429 al superar el maximo de intentos', () => {
    const middleware = rateLimit(2);
    const req = createMockReq('2.2.2.2');
    const next = vi.fn() as unknown as NextFunction;

    // 1ra y 2da solicitud: permitidas
    middleware(req, createMockRes(), next);
    middleware(req, createMockRes(), next);

    // 3ra solicitud: debe ser bloqueada
    const res = createMockRes();
    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('Too many requests') })
    );
  });

  it('lleva el conteo de forma independiente por IP', () => {
    const middleware = rateLimit(1);
    const next = vi.fn() as unknown as NextFunction;

    const resA1 = createMockRes();
    middleware(createMockReq('3.3.3.3'), resA1, next);
    expect(resA1.status).not.toHaveBeenCalled();

    const resB1 = createMockRes();
    middleware(createMockReq('4.4.4.4'), resB1, next);
    expect(resB1.status).not.toHaveBeenCalled();

    // La segunda solicitud de la IP 3.3.3.3 debe bloquearse (max = 1),
    // pero la IP 4.4.4.4 aun no ha excedido su propio limite.
    const resA2 = createMockRes();
    middleware(createMockReq('3.3.3.3'), resA2, next);
    expect(resA2.status).toHaveBeenCalledWith(429);
  });

  it('usa remoteAddress cuando req.ip no esta definido', () => {
    const middleware = rateLimit(5);
    const req = { ip: undefined, socket: { remoteAddress: '9.9.9.9' } } as unknown as Request;
    const res = createMockRes();
    const next = vi.fn() as unknown as NextFunction;

    expect(() => middleware(req, res, next)).not.toThrow();
    expect(next).toHaveBeenCalled();
  });
});
