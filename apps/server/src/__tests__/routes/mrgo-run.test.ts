/**
 * Pruebas de las rutas del loop agéntico de Mr Go (`src/routes/mrgo.ts`):
 *  - POST /run     → corre runAgentLoop (dry_run por defecto, live con execute)
 *  - POST /confirm → ejecuta EN VIVO una acción sensible confirmada por el dueño
 *
 * Se mockean runAgentLoop y executeAction para probar el CONTRATO de la ruta
 * (scope por businessId, modo, validación) sin llamar al LLM ni a servicios
 * reales. La validación de tool de /confirm usa el catálogo REAL (isValidToolKey).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: Request, res: Response, next: NextFunction) => {
    if (!req.headers.authorization) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }
    req.auth = { userId: 'user_1', businessId: 'biz_1', role: 'ADMIN' };
    next();
  },
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock('../../services/mrgo/agent-loop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/mrgo/agent-loop')>();
  return { ...actual, runAgentLoop: vi.fn(), resumeAgentLoop: vi.fn() };
});

// El orquestador se mockea para que la delegación de /run sea determinística
// (sin llamar al LLM ni a prisma): devuelve el agente que elige el CEO.
vi.mock('../../services/mrgo/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/mrgo/orchestrator')>();
  return { ...actual, orchestrate: vi.fn() };
});

vi.mock('../../services/actions/executor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/actions/executor')>();
  return { ...actual, executeAction: vi.fn() };
});

// La reserva de Idempotency-Key toca la DB: se mockea para probar solo el contrato HTTP.
vi.mock('../../lib/idempotency', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/idempotency')>();
  return { ...actual, claimIdempotentKey: vi.fn() };
});

vi.mock('../../services/mrgo/office', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/mrgo/office')>();
  return { ...actual, loadOffice: vi.fn(), saveOffice: vi.fn() };
});

vi.mock('../../services/mrgo/industry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/mrgo/industry')>();
  return { ...actual, loadIndustry: vi.fn(), saveIndustry: vi.fn() };
});

import { runAgentLoop, resumeAgentLoop } from '../../services/mrgo/agent-loop';
import { loadOffice, saveOffice } from '../../services/mrgo/office';
import { loadIndustry, saveIndustry } from '../../services/mrgo/industry';
import { orchestrate } from '../../services/mrgo/orchestrator';
import { executeAction } from '../../services/actions/executor';
import { claimIdempotentKey } from '../../lib/idempotency';
import { mrgoRouter } from '../../routes/mrgo';
import { errorHandler } from '../../middleware/errorHandler';

const AUTH = ['Authorization', 'Bearer token'] as const;
const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/mrgo', mrgoRouter);
  app.use(errorHandler);
  return app;
}

describe('routes/mrgo — loop agéntico', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    // Por defecto el CEO se queda con la orden (sin delegar en un especialista).
    mock(orchestrate).mockResolvedValue({ nextAgent: 'ceo', emotion: 'neutral', reasoning: '' });
    mock(claimIdempotentKey).mockResolvedValue(true);
  });

  describe('Idempotency-Key (at-most-once en acciones en vivo)', () => {
    const okRun = {
      agent: 'ceo', emotion: 'neutral', steps: [], finalMessage: 'ok', stoppedReason: 'final',
    };

    it('/run en vivo con clave nueva: la reserva (scope por ruta y negocio) y ejecuta', async () => {
      mock(runAgentLoop).mockResolvedValue(okRun);
      const res = await request(app)
        .post('/api/mrgo/run')
        .set(...AUTH)
        .set('Idempotency-Key', 'k-1')
        .send({ text: 'Mandá un WhatsApp', execute: true });

      expect(res.status).toBe(200);
      expect(claimIdempotentKey).toHaveBeenCalledWith(expect.anything(), 'biz_1', 'MRGO_IDEMPOTENCY', 'run:k-1');
      expect(runAgentLoop).toHaveBeenCalledTimes(1);
    });

    it('/run en vivo con clave ya usada: 409 y NO ejecuta nada', async () => {
      mock(claimIdempotentKey).mockResolvedValue(false);
      const res = await request(app)
        .post('/api/mrgo/run')
        .set(...AUTH)
        .set('Idempotency-Key', 'k-1')
        .send({ text: 'Mandá un WhatsApp', execute: true });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('DUPLICATE_REQUEST');
      expect(runAgentLoop).not.toHaveBeenCalled();
      expect(orchestrate).not.toHaveBeenCalled();
    });

    it('/run en dry_run no reserva clave aunque venga el header', async () => {
      mock(runAgentLoop).mockResolvedValue(okRun);
      const res = await request(app)
        .post('/api/mrgo/run')
        .set(...AUTH)
        .set('Idempotency-Key', 'k-1')
        .send({ text: 'Probá' });

      expect(res.status).toBe(200);
      expect(claimIdempotentKey).not.toHaveBeenCalled();
    });

    it('/run en vivo sin header sigue funcionando (compatibilidad)', async () => {
      mock(runAgentLoop).mockResolvedValue(okRun);
      const res = await request(app)
        .post('/api/mrgo/run')
        .set(...AUTH)
        .send({ text: 'Mandá un WhatsApp', execute: true });

      expect(res.status).toBe(200);
      expect(claimIdempotentKey).not.toHaveBeenCalled();
    });

    it('/confirm con clave repetida: 409 y NO ejecuta la acción', async () => {
      mock(claimIdempotentKey).mockResolvedValue(false);
      const res = await request(app)
        .post('/api/mrgo/confirm')
        .set(...AUTH)
        .set('Idempotency-Key', 'k-2')
        .send({ tool: 'enviar_whatsapp', params: { to: '+5491100000000', message: 'hola' } });

      expect(res.status).toBe(409);
      expect(executeAction).not.toHaveBeenCalled();
      expect(claimIdempotentKey).toHaveBeenCalledWith(expect.anything(), 'biz_1', 'MRGO_IDEMPOTENCY', 'confirm:k-2');
    });

    it('/confirm con tool inválido responde 400 sin consumir la clave', async () => {
      const res = await request(app)
        .post('/api/mrgo/confirm')
        .set(...AUTH)
        .set('Idempotency-Key', 'k-3')
        .send({ tool: 'no_existe' });

      expect(res.status).toBe(400);
      expect(claimIdempotentKey).not.toHaveBeenCalled();
    });

    it('/orchestrate con execute reserva la clave; sin execute no', async () => {
      await request(app).post('/api/mrgo/orchestrate').set(...AUTH).set('Idempotency-Key', 'k-4').send({ text: 'hola' });
      expect(claimIdempotentKey).not.toHaveBeenCalled();

      await request(app).post('/api/mrgo/orchestrate').set(...AUTH).set('Idempotency-Key', 'k-4').send({ text: 'hola', execute: true });
      expect(claimIdempotentKey).toHaveBeenCalledWith(expect.anything(), 'biz_1', 'MRGO_IDEMPOTENCY', 'orchestrate:k-4');
    });
  });

  describe('POST /api/mrgo/run', () => {
    it('corre el loop en dry_run por defecto y devuelve la traza (scope por businessId)', async () => {
      mock(runAgentLoop).mockResolvedValue({
        agent: 'ceo',
        emotion: 'entusiasmo',
        steps: [{ tool: 'crear_cliente', params: { name: 'Ana' }, result: { action: 'crear_cliente', kind: 'interno', ok: true, status: 'ejecutado', detail: 'cliente creado' } }],
        finalMessage: 'Listo, creé a Ana.',
        stoppedReason: 'final',
      });

      const res = await request(app)
        .post('/api/mrgo/run')
        .set(...AUTH)
        .send({ text: 'Registrá a Ana', channel: 'WHATSAPP' });

      expect(res.status).toBe(200);
      expect(res.body.stoppedReason).toBe('final');
      expect(res.body.steps).toHaveLength(1);
      // El CEO se quedó con la orden → corre el loop como 'ceo' (sin delegar).
      expect(runAgentLoop).toHaveBeenCalledWith({
        businessId: 'biz_1',
        text: 'Registrá a Ana',
        channel: 'WHATSAPP',
        agentKey: 'ceo',
        mode: 'dry_run',
        maxSteps: undefined,
      });
      expect(res.body.delegation).toBeUndefined();
    });

    it('delega en el especialista que elige el CEO (agentKey + delegation en la respuesta)', async () => {
      mock(orchestrate).mockResolvedValue({
        nextAgent: 'ventas',
        emotion: 'neutral',
        reasoning: 'Es una venta.',
      });
      mock(runAgentLoop).mockResolvedValue({
        agent: 'ventas',
        emotion: 'entusiasmo',
        steps: [],
        finalMessage: 'Cotizado.',
        stoppedReason: 'final',
      });

      const res = await request(app)
        .post('/api/mrgo/run')
        .set(...AUTH)
        .send({ text: 'cotizale al cliente' });

      expect(res.status).toBe(200);
      expect(runAgentLoop).toHaveBeenCalledWith(expect.objectContaining({ agentKey: 'ventas' }));
      expect(res.body.delegation).toEqual({ agent: 'ventas', reasoning: 'Es una venta.' });
      // Con delegación explícita, NO se vuelve a rutear.
      expect(orchestrate).toHaveBeenCalledTimes(1);
    });

    it('respeta el agentKey forzado por el dueño (delegación manual, sin rutear)', async () => {
      mock(runAgentLoop).mockResolvedValue({
        agent: 'cobros',
        emotion: 'neutral',
        steps: [],
        finalMessage: 'Listo.',
        stoppedReason: 'final',
      });

      const res = await request(app)
        .post('/api/mrgo/run')
        .set(...AUTH)
        .send({ text: 'cobrá la deuda', agentKey: 'cobros' });

      expect(res.status).toBe(200);
      expect(runAgentLoop).toHaveBeenCalledWith(expect.objectContaining({ agentKey: 'cobros' }));
      // agentKey explícito → no se llama al orquestador.
      expect(orchestrate).not.toHaveBeenCalled();
      expect(res.body.delegation).toBeUndefined();
    });

    it('con execute:true corre el loop EN VIVO (mode live)', async () => {
      mock(runAgentLoop).mockResolvedValue({
        agent: 'ceo',
        emotion: 'neutral',
        steps: [],
        finalMessage: '',
        stoppedReason: 'needs_confirmation',
        pending: { tool: 'generar_link_pago', params: { amount: 5000 }, kind: 'externo' },
      });

      const res = await request(app)
        .post('/api/mrgo/run')
        .set(...AUTH)
        .send({ text: 'cobrá la seña', execute: true, maxSteps: 3 });

      expect(res.status).toBe(200);
      expect(res.body.stoppedReason).toBe('needs_confirmation');
      expect(res.body.pending.tool).toBe('generar_link_pago');
      expect(runAgentLoop).toHaveBeenCalledWith(
        expect.objectContaining({ businessId: 'biz_1', mode: 'live', maxSteps: 3 }),
      );
    });

    it('400 si falta el texto (validación Zod)', async () => {
      const res = await request(app).post('/api/mrgo/run').set(...AUTH).send({});
      expect(res.status).toBe(400);
      expect(runAgentLoop).not.toHaveBeenCalled();
    });

    it('401 sin token', async () => {
      const res = await request(app).post('/api/mrgo/run').send({ text: 'hola' });
      expect(res.status).toBe(401);
      expect(runAgentLoop).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/mrgo/confirm', () => {
    it('ejecuta en vivo la acción confirmada (scope por businessId, mode live)', async () => {
      mock(executeAction).mockResolvedValue({
        action: 'generar_link_pago',
        kind: 'externo',
        ok: true,
        status: 'ejecutado',
        detail: 'link de pago generado',
        data: { url: 'https://pago' },
      });

      const res = await request(app)
        .post('/api/mrgo/confirm')
        .set(...AUTH)
        .send({ tool: 'generar_link_pago', params: { amount: 5000, title: 'Seña' } });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ejecutado');
      expect(executeAction).toHaveBeenCalledWith({
        businessId: 'biz_1',
        action: 'generar_link_pago',
        params: { amount: 5000, title: 'Seña' },
        mode: 'live',
      });
    });

    it('con resume: REANUDA la cadena (resumeAgentLoop) y devuelve la traza', async () => {
      mock(resumeAgentLoop).mockResolvedValue({
        agent: 'ventas',
        emotion: 'entusiasmo',
        steps: [
          { tool: 'generar_link_pago', params: { amount: 5000 }, result: { action: 'generar_link_pago', kind: 'externo', ok: true, status: 'ejecutado', detail: 'link' } },
          { tool: 'enviar_whatsapp', params: { body: 'listo' }, result: { action: 'enviar_whatsapp', kind: 'externo', ok: true, status: 'ejecutado', detail: 'enviado' } },
        ],
        finalMessage: 'Cobré y avisé.',
        stoppedReason: 'final',
      });

      const res = await request(app)
        .post('/api/mrgo/confirm')
        .set(...AUTH)
        .send({
          tool: 'generar_link_pago',
          params: { amount: 5000, title: 'Seña' },
          resume: { text: 'cobrá y avisá', agentKey: 'ventas', steps: [] },
        });

      expect(res.status).toBe(200);
      expect(res.body.stoppedReason).toBe('final');
      expect(res.body.steps).toHaveLength(2);
      expect(resumeAgentLoop).toHaveBeenCalledWith(
        expect.objectContaining({
          businessId: 'biz_1',
          text: 'cobrá y avisá',
          agentKey: 'ventas',
          mode: 'live',
          confirmed: expect.objectContaining({ tool: 'generar_link_pago' }),
        }),
      );
      // En modo resume NO se usa el executeAction suelto (lo hace el loop adentro).
      expect(executeAction).not.toHaveBeenCalled();
    });

    it('con resume y tool desconocido: 400 (no reanuda)', async () => {
      const res = await request(app)
        .post('/api/mrgo/confirm')
        .set(...AUTH)
        .send({ tool: 'tool_inventado', resume: { text: 'x', agentKey: 'ventas' } });

      expect(res.status).toBe(400);
      expect(resumeAgentLoop).not.toHaveBeenCalled();
    });

    it('400 si el tool no está en el catálogo (no ejecuta)', async () => {
      const res = await request(app)
        .post('/api/mrgo/confirm')
        .set(...AUTH)
        .send({ tool: 'tool_inventado', params: {} });

      expect(res.status).toBe(400);
      expect(executeAction).not.toHaveBeenCalled();
    });

    it('401 sin token', async () => {
      const res = await request(app).post('/api/mrgo/confirm').send({ tool: 'enviar_whatsapp' });
      expect(res.status).toBe(401);
      expect(executeAction).not.toHaveBeenCalled();
    });
  });

  describe('/office (estado persistente de la oficina)', () => {
    it('GET devuelve las pausas del negocio', async () => {
      mock(loadOffice).mockResolvedValue({ paused: ['ventas', 'cobros'] });
      const res = await request(app).get('/api/mrgo/office').set(...AUTH);
      expect(res.status).toBe(200);
      expect(res.body.paused).toEqual(['ventas', 'cobros']);
      expect(loadOffice).toHaveBeenCalledWith('biz_1');
    });

    it('PUT guarda las pausas (scope por businessId)', async () => {
      mock(saveOffice).mockResolvedValue({ paused: ['ventas'] });
      const res = await request(app)
        .put('/api/mrgo/office')
        .set(...AUTH)
        .send({ paused: ['ventas'] });
      expect(res.status).toBe(200);
      expect(res.body.paused).toEqual(['ventas']);
      expect(saveOffice).toHaveBeenCalledWith('biz_1', { paused: ['ventas'] });
    });

    it('PUT 400 con una clave de agente inválida (validación Zod)', async () => {
      const res = await request(app)
        .put('/api/mrgo/office')
        .set(...AUTH)
        .send({ paused: ['no_existe'] });
      expect(res.status).toBe(400);
      expect(saveOffice).not.toHaveBeenCalled();
    });

    it('401 sin token', async () => {
      const res = await request(app).get('/api/mrgo/office');
      expect(res.status).toBe(401);
      expect(loadOffice).not.toHaveBeenCalled();
    });
  });

  describe('/industry (giro del negocio — "bots por giro")', () => {
    it('GET devuelve el giro elegido del negocio', async () => {
      mock(loadIndustry).mockResolvedValue({ giroId: 'veterinaria' });
      const res = await request(app).get('/api/mrgo/industry').set(...AUTH);
      expect(res.status).toBe(200);
      expect(res.body.giroId).toBe('veterinaria');
      expect(loadIndustry).toHaveBeenCalledWith('biz_1');
    });

    it('PUT guarda el giro (scope por businessId)', async () => {
      mock(saveIndustry).mockResolvedValue({ giroId: 'cafeteria' });
      const res = await request(app)
        .put('/api/mrgo/industry')
        .set(...AUTH)
        .send({ giroId: 'cafeteria' });
      expect(res.status).toBe(200);
      expect(res.body.giroId).toBe('cafeteria');
      expect(saveIndustry).toHaveBeenCalledWith('biz_1', { giroId: 'cafeteria' });
    });

    it('PUT acepta giroId vacío (limpia el giro)', async () => {
      mock(saveIndustry).mockResolvedValue({ giroId: '' });
      const res = await request(app)
        .put('/api/mrgo/industry')
        .set(...AUTH)
        .send({ giroId: '' });
      expect(res.status).toBe(200);
      expect(res.body.giroId).toBe('');
    });

    it('401 sin token', async () => {
      const res = await request(app).get('/api/mrgo/industry');
      expect(res.status).toBe(401);
      expect(loadIndustry).not.toHaveBeenCalled();
    });
  });
});
