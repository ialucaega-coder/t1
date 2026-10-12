/**
 * Pruebas de integración para las rutas de Mr Go (`src/routes/mrgo.ts`) y para
 * el orquestador (`src/services/mrgo/orchestrator.ts`).
 *
 * Rutas: GET /agents (resueltos + catálogos), PUT /agents (saneo), POST
 * /orchestrate (devuelve la decisión), scope por businessId y 401 sin token.
 * Se mockean los servicios de persistencia (prisma, por detrás) y el motor de
 * IA para no llamar a un LLM real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

// --- Mock del servicio de agentes (persistencia) ---
vi.mock('../../services/mrgo/agents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/mrgo/agents')>();
  return {
    ...actual, // reusamos catálogos y saneadores reales
    loadAgents: vi.fn(async () => [
      { key: 'ceo', activo: true },
      { key: 'ventas', activo: true },
      { key: 'soporte', activo: false },
    ]),
    saveAgents: vi.fn(async (_biz: string, agents: unknown) => {
      const { sanitizeAgents } = actual;
      return sanitizeAgents(agents);
    }),
  };
});

// --- Mock del orquestador (para no ejercitar el LLM en la ruta) ---
vi.mock('../../services/mrgo/orchestrator', () => ({
  orchestrate: vi.fn(async () => ({
    nextAgent: 'ventas',
    emotion: 'entusiasmo',
    reasoning: 'El mensaje pide una cotización',
    tool: 'generar_link_pago',
    toolParams: { monto: 1000 },
  })),
}));

// --- Mock de auth: sin header Authorization → 401; con header → auth puesto ---
vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: Request, res: Response, next: NextFunction) => {
    if (!req.headers.authorization) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }
    req.auth = { userId: 'user_1', businessId: 'biz_1', role: 'ADMIN' };
    next();
  },
}));

import { loadAgents, saveAgents } from '../../services/mrgo/agents';
import { orchestrate } from '../../services/mrgo/orchestrator';
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

describe('routes/mrgo', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/mrgo/agents', () => {
    it('devuelve agentes resueltos + catálogos de roles y tools (scope por businessId)', async () => {
      const res = await request(app).get('/api/mrgo/agents').set(...AUTH);

      expect(res.status).toBe(200);
      expect(res.body.agents).toHaveLength(3);
      expect(res.body.roles).toBeInstanceOf(Array);
      expect(res.body.roles.length).toBeGreaterThan(0);
      expect(res.body.tools).toBeInstanceOf(Array);
      expect(res.body.tools.length).toBeGreaterThan(0);
      expect(loadAgents).toHaveBeenCalledWith('biz_1');
    });

    it('401 sin token', async () => {
      const res = await request(app).get('/api/mrgo/agents');
      expect(res.status).toBe(401);
      expect(loadAgents).not.toHaveBeenCalled();
    });
  });

  describe('PUT /api/mrgo/agents', () => {
    it('guarda la config inyectando el businessId del auth', async () => {
      const res = await request(app)
        .put('/api/mrgo/agents')
        .set(...AUTH)
        .send({ agents: [{ key: 'ceo', activo: true }, { key: 'ventas', activo: false }] });

      expect(res.status).toBe(200);
      expect(saveAgents).toHaveBeenCalledWith('biz_1', expect.any(Array));
      expect(res.body.agents).toBeInstanceOf(Array);
    });

    it('sanea descartando roles fuera del catálogo (validación Zod → 400)', async () => {
      const res = await request(app)
        .put('/api/mrgo/agents')
        .set(...AUTH)
        .send({ agents: [{ key: 'rol_inventado', activo: true }] });

      expect(res.status).toBe(400);
      expect(saveAgents).not.toHaveBeenCalled();
    });

    it('401 sin token', async () => {
      const res = await request(app)
        .put('/api/mrgo/agents')
        .send({ agents: [] });
      expect(res.status).toBe(401);
      expect(saveAgents).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/mrgo/orchestrate', () => {
    it('devuelve la decisión de routing del orquestador', async () => {
      const res = await request(app)
        .post('/api/mrgo/orchestrate')
        .set(...AUTH)
        .send({ text: 'Quiero una cotización', channel: 'WHATSAPP' });

      expect(res.status).toBe(200);
      expect(res.body.nextAgent).toBe('ventas');
      expect(res.body.emotion).toBe('entusiasmo');
      expect(res.body.tool).toBe('generar_link_pago');
      expect(orchestrate).toHaveBeenCalledWith({
        businessId: 'biz_1',
        text: 'Quiero una cotización',
        channel: 'WHATSAPP',
      });
    });

    it('400 si falta el texto (validación Zod)', async () => {
      const res = await request(app).post('/api/mrgo/orchestrate').set(...AUTH).send({});
      expect(res.status).toBe(400);
      expect(orchestrate).not.toHaveBeenCalled();
    });

    it('401 sin token', async () => {
      const res = await request(app).post('/api/mrgo/orchestrate').send({ text: 'hola' });
      expect(res.status).toBe(401);
      expect(orchestrate).not.toHaveBeenCalled();
    });
  });
});

// --- Pruebas del orquestador contra un motor de IA mockeado ---
vi.mock('../../services/ai/engine', () => ({
  getAIProviderForBusiness: vi.fn(),
}));

import { getAIProviderForBusiness } from '../../services/ai/engine';

describe('services/mrgo/orchestrator', () => {
  // Importamos la implementación REAL del orquestador (el mock de arriba solo
  // afecta a la ruta); acá verificamos el parseo/fallback contra el motor IA.
  let orchestrateReal: typeof import('../../services/mrgo/orchestrator').orchestrate;

  beforeEach(async () => {
    vi.clearAllMocks();
    const real = await vi.importActual<typeof import('../../services/mrgo/orchestrator')>(
      '../../services/mrgo/orchestrator'
    );
    orchestrateReal = real.orchestrate;
    // loadAgents está mockeado arriba: ceo + ventas activos, soporte inactivo.
    mock(loadAgents).mockResolvedValue([
      { key: 'ceo', activo: true },
      { key: 'ventas', activo: true },
      { key: 'soporte', activo: false },
    ]);
  });

  function fakeProvider(response: string) {
    mock(getAIProviderForBusiness).mockResolvedValue({
      name: 'fake',
      generateResponse: vi.fn(async () => response),
    });
  }

  it('devuelve la decisión parseada cuando el LLM responde JSON', async () => {
    fakeProvider('{"nextAgent":"ventas","emotion":"calma","reasoning":"pide precio","tool":"generar_link_pago","toolParams":{"monto":500}}');

    const dec = await orchestrateReal({ businessId: 'biz_1', text: 'cuánto sale' });

    expect(dec.nextAgent).toBe('ventas');
    expect(dec.emotion).toBe('calma');
    expect(dec.tool).toBe('generar_link_pago');
    expect(dec.toolParams).toEqual({ monto: 500 });
  });

  it('extrae el JSON aunque venga rodeado de texto', async () => {
    fakeProvider('Claro, acá va:\n{"nextAgent":"ceo","emotion":"neutral","reasoning":"general"}\n¡Listo!');

    const dec = await orchestrateReal({ businessId: 'biz_1', text: 'hola' });

    expect(dec.nextAgent).toBe('ceo');
    expect(dec.tool).toBeUndefined();
  });

  it('cae al fallback (ceo) ante un JSON inválido', async () => {
    fakeProvider('no soy json, perdón');

    const dec = await orchestrateReal({ businessId: 'biz_1', text: 'hola' });

    expect(dec.nextAgent).toBe('ceo');
    expect(dec.reasoning).toContain('Routing por defecto');
  });

  it('descarta un agente que no está activo y cae al fallback', async () => {
    fakeProvider('{"nextAgent":"soporte","emotion":"x","reasoning":"y"}');

    const dec = await orchestrateReal({ businessId: 'biz_1', text: 'hola' });

    expect(dec.nextAgent).toBe('ceo'); // soporte está inactivo → fallback
  });

  it('descarta un tool fuera del catálogo pero conserva el agente', async () => {
    fakeProvider('{"nextAgent":"ventas","emotion":"x","reasoning":"y","tool":"tool_inventado"}');

    const dec = await orchestrateReal({ businessId: 'biz_1', text: 'hola' });

    expect(dec.nextAgent).toBe('ventas');
    expect(dec.tool).toBeUndefined();
  });

  it('fallback si el motor de IA no está disponible', async () => {
    mock(getAIProviderForBusiness).mockRejectedValue(new Error('sin motor'));

    const dec = await orchestrateReal({ businessId: 'biz_1', text: 'hola' });

    expect(dec.nextAgent).toBe('ceo');
    expect(dec.reasoning).toContain('motor de IA');
  });
});
