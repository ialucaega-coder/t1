/**
 * Pruebas unitarias para el middleware de validacion con Zod
 * (`src/middleware/validate.ts`).
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { validate } from '../../middleware/validate';

function createMockRes(): Response {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

describe('middleware/validate', () => {
  const schema = z.object({
    email: z.string().email(),
    age: z.number().int().positive(),
  });

  it('llama a next() y asigna el body parseado cuando los datos son validos', () => {
    const middleware = validate(schema);
    const req = { body: { email: 'test@example.com', age: 30 } } as unknown as Request;
    const res = createMockRes();
    const next = vi.fn() as unknown as NextFunction;

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.body).toEqual({ email: 'test@example.com', age: 30 });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('responde 400 con detalles del error cuando los datos son invalidos', () => {
    const middleware = validate(schema);
    const req = { body: { email: 'no-es-un-email', age: -5 } } as unknown as Request;
    const res = createMockRes();
    const next = vi.fn() as unknown as NextFunction;

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Validation failed',
        details: expect.arrayContaining([
          expect.objectContaining({ field: 'email' }),
        ]),
      })
    );
  });

  it('rechaza cuando falta un campo requerido', () => {
    const middleware = validate(schema);
    const req = { body: { email: 'test@example.com' } } as unknown as Request;
    const res = createMockRes();
    const next = vi.fn() as unknown as NextFunction;

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.details.some((d: { field: string }) => d.field === 'age')).toBe(true);
  });

  it('propaga errores que no son de Zod a next()', () => {
    const throwingSchema = {
      parse: () => {
        throw new Error('fallo inesperado');
      },
    } as unknown as z.ZodSchema;
    const middleware = validate(throwingSchema);
    const req = { body: {} } as unknown as Request;
    const res = createMockRes();
    const next = vi.fn() as unknown as NextFunction;

    middleware(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(res.status).not.toHaveBeenCalled();
  });
});
