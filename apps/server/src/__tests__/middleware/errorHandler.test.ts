/**
 * Pruebas unitarias para el middleware de manejo de errores centralizado
 * (`src/middleware/errorHandler.ts`): AppError, asyncHandler y errorHandler.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { ZodError, ZodIssue } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError, asyncHandler, errorHandler, notFoundHandler } from '../../middleware/errorHandler';

// --- helpers ----------------------------------------------------------------

function createMockRes(): Response {
  const res: Partial<Response> = { headersSent: false };
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

const dummyReq = {} as Request;
const dummyNext = vi.fn() as unknown as NextFunction;

// ---------------------------------------------------------------------------
// AppError
// ---------------------------------------------------------------------------
describe('middleware/errorHandler - AppError', () => {
  it('almacena statusCode, message y details', () => {
    const err = new AppError(404, 'No encontrado', { id: '123' });

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AppError');
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('No encontrado');
    expect(err.details).toEqual({ id: '123' });
  });

  it('funciona sin details opcionales', () => {
    const err = new AppError(403, 'Prohibido');

    expect(err.details).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// asyncHandler
// ---------------------------------------------------------------------------
describe('middleware/errorHandler - asyncHandler', () => {
  it('llama a next con el error cuando la promesa es rechazada', async () => {
    const error = new Error('fallo async');
    const handler = asyncHandler(async () => {
      throw error;
    });
    const next = vi.fn();

    handler(dummyReq, createMockRes(), next);

    // El catch es asincronico; esperamos un tick
    await new Promise((r) => setTimeout(r, 0));
    expect(next).toHaveBeenCalledWith(error);
  });

  it('no llama a next cuando el handler se resuelve correctamente', async () => {
    const handler = asyncHandler(async (_req, res) => {
      res.status(200).json({ ok: true });
    });
    const next = vi.fn();
    const res = createMockRes();

    handler(dummyReq, res, next);

    await new Promise((r) => setTimeout(r, 0));
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// ---------------------------------------------------------------------------
// errorHandler middleware
// ---------------------------------------------------------------------------
describe('middleware/errorHandler - errorHandler', () => {
  it('no envia respuesta si headers ya fueron enviados', () => {
    const res = createMockRes();
    (res as any).headersSent = true;

    errorHandler(new Error('x'), dummyReq, res, dummyNext);

    expect(res.status).not.toHaveBeenCalled();
  });

  it('responde 400 con detalles ante un ZodError', () => {
    const issues: ZodIssue[] = [
      { code: 'invalid_type', expected: 'string', received: 'number', path: ['email'], message: 'Esperado string' },
    ];
    const err = new ZodError(issues);
    const res = createMockRes();

    errorHandler(err, dummyReq, res, dummyNext);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Validation failed',
        details: [{ field: 'email', message: 'Esperado string' }],
      })
    );
  });

  it('responde 409 ante un error Prisma P2002 (unique constraint)', () => {
    const err = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '5.0.0',
      meta: { target: ['email'] },
    });
    const res = createMockRes();

    errorHandler(err, dummyReq, res, dummyNext);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('email') })
    );
  });

  it('responde 404 ante un error Prisma P2025 (record not found)', () => {
    const err = new Prisma.PrismaClientKnownRequestError('Record not found', {
      code: 'P2025',
      clientVersion: '5.0.0',
    });
    const res = createMockRes();

    errorHandler(err, dummyReq, res, dummyNext);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('responde 400 ante un error Prisma P2003 (foreign key)', () => {
    const err = new Prisma.PrismaClientKnownRequestError('FK constraint', {
      code: 'P2003',
      clientVersion: '5.0.0',
    });
    const res = createMockRes();

    errorHandler(err, dummyReq, res, dummyNext);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('Referencia') })
    );
  });

  it('responde con el statusCode y message de un AppError', () => {
    const err = new AppError(422, 'Datos incompletos', { missing: 'field' });
    const res = createMockRes();

    errorHandler(err, dummyReq, res, dummyNext);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({ error: 'Datos incompletos', details: { missing: 'field' } });
  });

  it('responde 500 ante un error generico desconocido', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = createMockRes();

    errorHandler(new Error('algo inesperado'), dummyReq, res, dummyNext);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
    consoleSpy.mockRestore();
  });

  it('responde 400 ante un PrismaClientValidationError', () => {
    const err = new Prisma.PrismaClientValidationError('Validation error', {
      clientVersion: '5.0.0',
    });
    const res = createMockRes();

    errorHandler(err, dummyReq, res, dummyNext);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('inválidos') })
    );
  });
});

// ---------------------------------------------------------------------------
// notFoundHandler
// ---------------------------------------------------------------------------
describe('middleware/errorHandler - notFoundHandler', () => {
  it('responde 404 con la ruta solicitada', () => {
    const req = { method: 'GET', originalUrl: '/api/v1/missing' } as Request;
    const res = createMockRes();

    notFoundHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Ruta no encontrada: GET /api/v1/missing',
    });
  });
});
