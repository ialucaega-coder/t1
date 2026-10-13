/**
 * Pruebas de integración para las rutas de workflows / automatización
 * (`src/routes/workflows.ts`): listar reglas + catálogos, crear (201 +
 * validación 400 + descarte de triggers/acciones fuera de catálogo), editar /
 * activar-desactivar (PATCH), borrar (204/404), todo con scope por businessId.
 *
 * Se mockean Prisma y el middleware de auth. La lógica de persistencia del
 * servicio (transacción + lock + saneo) se prueba aparte; acá verificamos el
 * cableado de las rutas (validación Zod, scope por negocio, códigos de estado).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

// Mock del servicio: devolvemos datos controlados y verificamos que la ruta
// pasa el businessId del auth. El saneo real (catálogo, lock) se prueba en el
// test del servicio.
vi.mock('../../services/workflows', () => ({
  TRIGGER_CATALOG: [
    { key: 'mensaje_entrante', label: 'Mensaje entrante', description: '' },
    { key: 'nueva_reserva', label: 'Nueva reserva', description: '' },
  ],
  ACTION_CATALOG: [
    { key: 'asignar_agente', label: 'Asignar agente', description: '' },
    { key: 'enviar_whatsapp', label: 'Enviar WhatsApp', description: '' },
  ],
  TRIGGER_KEYS: ['mensaje_entrante', 'nueva_reserva', 'lead_nuevo', 'pago_recibido'],
  ACTION_KEYS: ['asignar_agente', 'enviar_whatsapp', 'mover_lifecycle', 'notificar'],
  MAX_NAME_LEN: 120,
  MAX_CONDITION_LEN: 500,
  loadWorkflows: vi.fn(async () => [
    { id: 'r1', nombre: 'Bienvenida', activo: true, trigger: 'mensaje_entrante', accion: 'enviar_whatsapp' },
  ]),
  createWorkflow: vi.fn(async (_biz: string, input: Record<string, unknown>) => ({
    id: 'nuevo',
    activo: true,
    ...input,
  })),
  updateWorkflow: vi.fn(async () => ({
    id: 'r1',
    nombre: 'Bienvenida',
    activo: false,
    trigger: 'mensaje_entrante',
    accion: 'enviar_whatsapp',
  })),
  deleteWorkflow: vi.fn(async () => true),
  runWorkflows: vi.fn(async () => ({
    matched: 1,
    results: [
      { ruleId: 'r1', nombre: 'Bienvenida', accion: 'enviar_whatsapp', result: { action: 'enviar_whatsapp', kind: 'externo', ok: true, status: 'simulado', detail: 'se enviaría WhatsApp a ••••5678' } },
    ],
  })),
}));

vi.mock('../../services/workflows/settings', () => ({
  isAutomationLive: vi.fn(async () => false),
  setAutomationLive: vi.fn(async (_biz: string, live: boolean) => live),
}));

vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: 'user_1', businessId: 'biz_1', role: 'ADMIN' };
    next();
  },
  // Factory passthrough: en estos tests el auth siempre es ADMIN.
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

import {
  loadWorkflows,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  runWorkflows,
} from '../../services/workflows';
import { isAutomationLive, setAutomationLive } from '../../services/workflows/settings';
import { workflowsRouter } from '../../routes/workflows';
import { errorHandler } from '../../middleware/errorHandler';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/workflows', workflowsRouter);
  app.use(errorHandler);
  return app;
}

describe('routes/workflows', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/workflows', () => {
    it('lista las reglas del negocio (scope por businessId) + catálogos', async () => {
      const res = await request(app).get('/api/workflows');

      expect(res.status).toBe(200);
      expect(res.body.rules).toHaveLength(1);
      expect(res.body.triggers).toBeInstanceOf(Array);
      expect(res.body.actions).toBeInstanceOf(Array);
      expect(loadWorkflows).toHaveBeenCalledWith('biz_1');
    });
  });

  describe('POST /api/workflows', () => {
    const validPayload = {
      nombre: 'Saludar leads',
      trigger: 'lead_nuevo',
      accion: 'enviar_whatsapp',
      condicion: 'canal = whatsapp',
    };

    it('crea una regla (201) inyectando el businessId del auth', async () => {
      const res = await request(app).post('/api/workflows').send(validPayload);

      expect(res.status).toBe(201);
      expect(createWorkflow).toHaveBeenCalledWith(
        'biz_1',
        expect.objectContaining({ nombre: 'Saludar leads', trigger: 'lead_nuevo', accion: 'enviar_whatsapp' })
      );
    });

    it('devuelve 400 cuando falta el nombre (validación Zod)', async () => {
      const res = await request(app)
        .post('/api/workflows')
        .send({ trigger: 'lead_nuevo', accion: 'enviar_whatsapp' });

      expect(res.status).toBe(400);
      expect(createWorkflow).not.toHaveBeenCalled();
    });

    it('descarta un trigger fuera del catálogo (400)', async () => {
      const res = await request(app)
        .post('/api/workflows')
        .send({ nombre: 'x', trigger: 'trigger_inventado', accion: 'enviar_whatsapp' });

      expect(res.status).toBe(400);
      expect(createWorkflow).not.toHaveBeenCalled();
    });

    it('descarta una acción fuera del catálogo (400)', async () => {
      const res = await request(app)
        .post('/api/workflows')
        .send({ nombre: 'x', trigger: 'lead_nuevo', accion: 'accion_inventada' });

      expect(res.status).toBe(400);
      expect(createWorkflow).not.toHaveBeenCalled();
    });

    it('devuelve 400 si el servicio rechaza (límite/datos)', async () => {
      mock(createWorkflow).mockResolvedValueOnce(null);

      const res = await request(app).post('/api/workflows').send(validPayload);

      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /api/workflows/:id', () => {
    it('activa/desactiva una regla con scope por businessId', async () => {
      const res = await request(app).patch('/api/workflows/r1').send({ activo: false });

      expect(res.status).toBe(200);
      expect(res.body.activo).toBe(false);
      expect(updateWorkflow).toHaveBeenCalledWith('biz_1', 'r1', { activo: false });
    });

    it('devuelve 404 si la regla no pertenece al negocio', async () => {
      mock(updateWorkflow).mockResolvedValueOnce(null);

      const res = await request(app).patch('/api/workflows/de-otro-negocio').send({ activo: false });

      expect(res.status).toBe(404);
    });

    it('devuelve 400 con un body vacío (nada para actualizar)', async () => {
      const res = await request(app).patch('/api/workflows/r1').send({});

      expect(res.status).toBe(400);
      expect(updateWorkflow).not.toHaveBeenCalled();
    });

    it('devuelve 400 con un trigger fuera del catálogo', async () => {
      const res = await request(app).patch('/api/workflows/r1').send({ trigger: 'nope' });

      expect(res.status).toBe(400);
      expect(updateWorkflow).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/workflows/:id', () => {
    it('borra la regla con scope por businessId (204)', async () => {
      const res = await request(app).delete('/api/workflows/r1');

      expect(res.status).toBe(204);
      expect(deleteWorkflow).toHaveBeenCalledWith('biz_1', 'r1');
    });

    it('devuelve 404 si la regla no pertenece al negocio', async () => {
      mock(deleteWorkflow).mockResolvedValueOnce(false);

      const res = await request(app).delete('/api/workflows/de-otro-negocio');

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/workflows/run', () => {
    it('dispara las reglas del trigger en dry_run por defecto (scope por businessId)', async () => {
      const res = await request(app)
        .post('/api/workflows/run')
        .send({ trigger: 'mensaje_entrante', payload: { clientId: 'c1' } });

      expect(res.status).toBe(200);
      expect(res.body.mode).toBe('dry_run');
      expect(res.body.matched).toBe(1);
      expect(res.body.results).toHaveLength(1);
      expect(runWorkflows).toHaveBeenCalledWith('biz_1', { trigger: 'mensaje_entrante', payload: { clientId: 'c1' } }, 'dry_run');
    });

    it('con execute=true corre en vivo', async () => {
      const res = await request(app)
        .post('/api/workflows/run')
        .send({ trigger: 'mensaje_entrante', execute: true });

      expect(res.status).toBe(200);
      expect(res.body.mode).toBe('live');
      expect(runWorkflows).toHaveBeenCalledWith('biz_1', { trigger: 'mensaje_entrante', payload: undefined }, 'live');
    });

    it('devuelve 400 con un trigger fuera del catálogo', async () => {
      const res = await request(app).post('/api/workflows/run').send({ trigger: 'nope' });

      expect(res.status).toBe(400);
      expect(runWorkflows).not.toHaveBeenCalled();
    });
  });

  describe('GET/PUT /api/workflows/settings', () => {
    it('GET devuelve el flag live del negocio', async () => {
      mock(isAutomationLive).mockResolvedValueOnce(true);

      const res = await request(app).get('/api/workflows/settings');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ live: true });
      expect(isAutomationLive).toHaveBeenCalledWith('biz_1');
    });

    it('PUT cambia el flag (scope por businessId)', async () => {
      const res = await request(app).put('/api/workflows/settings').send({ live: true });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ live: true });
      expect(setAutomationLive).toHaveBeenCalledWith('biz_1', true);
    });

    it('PUT devuelve 400 si falta el flag (validación Zod)', async () => {
      const res = await request(app).put('/api/workflows/settings').send({});

      expect(res.status).toBe(400);
      expect(setAutomationLive).not.toHaveBeenCalled();
    });
  });
});
