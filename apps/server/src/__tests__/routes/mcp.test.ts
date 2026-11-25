/**
 * Ruta MCP (`routes/mcp.ts`): solo staff, tope de mensajes por batch, rate limit
 * por negocio y modo en vivo (`execute:true`) reservado a ADMIN.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    const role = (req.headers['x-test-role'] as 'ADMIN' | 'PROFESSIONAL' | 'CLIENT' | undefined) ?? 'ADMIN';
    req.auth = { userId: 'user_1', businessId: 'biz_1', role };
    next();
  },
  requireStaff: (req: Request, res: Response, next: NextFunction) => {
    if (!['ADMIN', 'PROFESSIONAL'].includes(req.auth?.role ?? '')) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  },
}));

const rateLimitOpts = vi.hoisted(() => [] as unknown[]);
vi.mock('../../middleware/tenantRateLimit', () => ({
  tenantRateLimit: (opts: unknown) => {
    rateLimitOpts.push(opts);
    return (_req: Request, _res: Response, next: NextFunction) => next();
  },
}));

vi.mock('../../services/workflows/settings', () => ({ getAutomationMode: vi.fn(async () => 'dry_run') }));
vi.mock('../../services/actions/executor', () => ({ executeAction: vi.fn() }));

import { executeAction } from '../../services/actions/executor';
import { mcpRouter, MCP_MAX_BATCH } from '../../routes/mcp';
import { errorHandler } from '../../middleware/errorHandler';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/mcp', mcpRouter);
  app.use(errorHandler);
  return app;
}

const call = (id: number, execute?: boolean) => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: { name: 'crear_cliente', arguments: { params: { name: 'Ana' }, ...(execute !== undefined ? { execute } : {}) } },
});

describe('routes/mcp', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    mock(executeAction).mockResolvedValue({ action: 'crear_cliente', kind: 'interno', ok: true, status: 'simulado', detail: 'ok' });
  });

  it('monta un rate limit por negocio para el endpoint MCP', () => {
    expect(rateLimitOpts).toContainEqual(expect.objectContaining({ name: 'mcp' }));
  });

  it('un CLIENT no puede usar MCP (403, sin ejecutar nada)', async () => {
    const res = await request(app).post('/api/mcp').set('x-test-role', 'CLIENT').send(call(1));

    expect(res.status).toBe(403);
    expect(executeAction).not.toHaveBeenCalled();
  });

  it('un mensaje único de staff responde normal', async () => {
    const res = await request(app).post('/api/mcp').set('x-test-role', 'PROFESSIONAL').send({ jsonrpc: '2.0', id: 1, method: 'ping' });

    expect(res.status).toBe(200);
    expect(res.body.result).toEqual({});
  });

  it(`un batch de más de ${MCP_MAX_BATCH} mensajes se rechaza (400) sin ejecutar nada`, async () => {
    const batch = Array.from({ length: MCP_MAX_BATCH + 1 }, (_, i) => call(i + 1));

    const res = await request(app).post('/api/mcp').send(batch);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(-32600);
    expect(executeAction).not.toHaveBeenCalled();
  });

  it(`un batch de exactamente ${MCP_MAX_BATCH} mensajes sí se procesa`, async () => {
    const batch = Array.from({ length: MCP_MAX_BATCH }, (_, i) => call(i + 1));

    const res = await request(app).post('/api/mcp').send(batch);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(MCP_MAX_BATCH);
    expect(executeAction).toHaveBeenCalledTimes(MCP_MAX_BATCH);
  });

  it('execute:true en vivo: un ADMIN ejecuta en live', async () => {
    await request(app).post('/api/mcp').set('x-test-role', 'ADMIN').send(call(1, true));

    expect(executeAction).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'biz_1', mode: 'live' }));
  });

  it('execute:true de un PROFESSIONAL se ignora: queda en dry_run', async () => {
    await request(app).post('/api/mcp').set('x-test-role', 'PROFESSIONAL').send(call(1, true));

    expect(executeAction).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'biz_1', mode: 'dry_run' }));
  });
});
