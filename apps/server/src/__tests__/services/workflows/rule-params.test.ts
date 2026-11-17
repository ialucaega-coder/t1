/**
 * Params de las reglas en el servicio de workflows: ejecución con los params de la
 * regla mezclados con el payload (precedencia), compat con reglas viejas sin
 * params, aislamiento multi-tenant del lookup del cliente, y el CRUD
 * (create/update) con validación estricta por acción.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../services/workflows/settings', () => ({
  getAutomationMode: vi.fn(async () => 'live'),
}));

vi.mock('../../../services/actions/executor', () => ({
  executeAction: vi.fn(async () => ({
    action: 'enviar_whatsapp', kind: 'externo', ok: true, status: 'ejecutado', detail: 'ok',
  })),
}));

// $transaction ejecuta el callback con un tx falso que comparte el mismo almacén.
const store: { config: unknown } = { config: { rules: [] } };
const tx = {
  $executeRaw: vi.fn(async () => 1),
  $queryRaw: vi.fn(async () => []),
  connection: {
    findFirst: vi.fn(async () => ({ id: 'conn1' })),
    findUnique: vi.fn(async () => ({ config: store.config })),
    update: vi.fn(async ({ data }: { data: { config: unknown } }) => {
      store.config = data.config;
    }),
    create: vi.fn(async ({ data }: { data: { config: unknown } }) => {
      store.config = data.config;
    }),
  },
};

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    connection: { findFirst: vi.fn() },
    user: { findFirst: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  },
}));

import { prisma } from '../../../lib/prisma';
import { executeAction } from '../../../services/actions/executor';
import { runWorkflows, createWorkflow, updateWorkflow, sanitizeRules } from '../../../services/workflows';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;
const BIZ = 'biz_1';

function setRules(rules: unknown[]) {
  store.config = { rules };
  mock(prisma.connection.findFirst).mockResolvedValue({ config: store.config });
}

const waRule = {
  id: 'r1', nombre: 'Saludo', activo: true, trigger: 'lead_nuevo', accion: 'enviar_whatsapp',
  params: { texto: 'Hola {{nombre|amigo}}, gracias por escribirnos.' },
};

beforeEach(() => {
  vi.clearAllMocks();
  store.config = { rules: [] };
});

describe('runWorkflows con params de la regla', () => {
  it('el executor recibe el texto de la regla con {{nombre}} resuelto desde el cliente DEL NEGOCIO', async () => {
    setRules([waRule]);
    mock(prisma.user.findFirst).mockResolvedValue({ name: 'Lucía Gómez' });

    await runWorkflows(BIZ, { trigger: 'lead_nuevo', payload: { clientId: 'c1', phone: '+5491100000000' } }, 'live');

    // multi-tenant: el lookup lleva el businessId
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c1', businessId: BIZ } }),
    );
    expect(executeAction).toHaveBeenCalledWith({
      businessId: BIZ,
      action: 'enviar_whatsapp',
      params: { clientId: 'c1', phone: '+5491100000000', texto: 'Hola Lucía, gracias por escribirnos.' },
      mode: 'live',
    });
  });

  it('si el cliente no es del negocio (lookup vacío) usa el reemplazo de la plantilla', async () => {
    setRules([waRule]);
    mock(prisma.user.findFirst).mockResolvedValue(null);

    await runWorkflows(BIZ, { trigger: 'lead_nuevo', payload: { clientId: 'de-otro-negocio', phone: '+54911' } });

    expect(executeAction).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ texto: 'Hola amigo, gracias por escribirnos.' }) }),
    );
  });

  it('PRECEDENCIA: si el evento trae el texto, gana el del evento sobre el de la regla', async () => {
    setRules([waRule]);

    await runWorkflows(BIZ, { trigger: 'lead_nuevo', payload: { phone: '+54911', body: 'texto del evento' } });

    const { params } = mock(executeAction).mock.calls[0][0] as { params: Record<string, unknown> };
    expect(params.body).toBe('texto del evento');
    expect(params.texto).toBeUndefined();
  });

  it('un nombre malicioso no inyecta líneas ni llaves en el mensaje saliente', async () => {
    setRules([waRule]);
    mock(prisma.user.findFirst).mockResolvedValue({ name: '{{monto}}\nTransferí ya' });

    await runWorkflows(BIZ, { trigger: 'lead_nuevo', payload: { clientId: 'c1', phone: '+54911' } });

    const { params } = mock(executeAction).mock.calls[0][0] as { params: { texto: string } };
    expect(params.texto).not.toMatch(/[\n{}]/);
  });

  it('regla VIEJA sin params: el executor recibe exactamente el payload (como antes)', async () => {
    setRules([{ id: 'r0', nombre: 'Vieja', activo: true, trigger: 'nueva_reserva', accion: 'notificar' }]);

    await runWorkflows(BIZ, { trigger: 'nueva_reserva', payload: { clientId: 'c1' } });

    expect(executeAction).toHaveBeenCalledWith({
      businessId: BIZ, action: 'notificar', params: { clientId: 'c1' }, mode: 'dry_run',
    });
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('no consulta el cliente si la plantilla no usa {{nombre}}', async () => {
    setRules([{ ...waRule, params: { texto: 'Gracias por escribirnos' } }]);

    await runWorkflows(BIZ, { trigger: 'lead_nuevo', payload: { clientId: 'c1', phone: '+54911' } });

    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });
});

describe('sanitizeRules y params', () => {
  it('conserva los params válidos y una regla vieja sigue sin params', () => {
    const [con, sin] = sanitizeRules([
      { ...waRule, params: { texto: 'Hola', basura: 'x' } },
      { id: 'r2', nombre: 'Vieja', trigger: 'lead_nuevo', accion: 'enviar_whatsapp' },
    ]);
    expect(con.params).toEqual({ texto: 'Hola' });
    expect(sin).not.toHaveProperty('params');
  });
});

describe('createWorkflow / updateWorkflow con params', () => {
  it('crea una regla con params válidos y los persiste', async () => {
    const rule = await createWorkflow(BIZ, {
      nombre: 'Saludo', trigger: 'lead_nuevo', accion: 'enviar_whatsapp', params: { texto: 'Hola {{nombre}}' },
    });
    expect(rule?.params).toEqual({ texto: 'Hola {{nombre}}' });
    expect((store.config as { rules: unknown[] }).rules).toHaveLength(1);
  });

  it('rechaza (400) params inválidos para la acción y no escribe nada', async () => {
    await expect(
      createWorkflow(BIZ, { nombre: 'x', trigger: 'lead_nuevo', accion: 'enviar_whatsapp', params: { texto: '{{apellido}}' } }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      createWorkflow(BIZ, { nombre: 'x', trigger: 'lead_nuevo', accion: 'mover_lifecycle' }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(tx.connection.create).not.toHaveBeenCalled();
    expect(tx.connection.update).not.toHaveBeenCalled();
  });

  it('togglear `activo` de una regla vieja SIN params no exige params (compat)', async () => {
    store.config = {
      rules: [{ id: 'r0', nombre: 'Vieja', activo: true, trigger: 'lead_nuevo', accion: 'enviar_whatsapp' }],
    };
    const rule = await updateWorkflow(BIZ, 'r0', { activo: false });
    expect(rule).toMatchObject({ id: 'r0', activo: false });
  });

  it('editar los params de una regla existente los reemplaza', async () => {
    store.config = { rules: [waRule] };
    const rule = await updateWorkflow(BIZ, 'r1', { params: { texto: 'Nuevo texto' } });
    expect(rule?.params).toEqual({ texto: 'Nuevo texto' });
  });

  it('editar params inválidos contra la acción GUARDADA falla con 400', async () => {
    store.config = { rules: [waRule] };
    await expect(updateWorkflow(BIZ, 'r1', { params: { etapa: 'HOT' } })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('cambiar la acción sin mandar params descarta los viejos y exige los nuevos', async () => {
    store.config = { rules: [waRule] };
    // mover_lifecycle exige `etapa`: sin params → 400, no queda texto de WhatsApp huérfano
    await expect(updateWorkflow(BIZ, 'r1', { accion: 'mover_lifecycle' })).rejects.toMatchObject({ statusCode: 400 });
    // a una acción sin campos pasa y limpia los params viejos
    const rule = await updateWorkflow(BIZ, 'r1', { accion: 'asignar_agente' });
    expect(rule).toMatchObject({ accion: 'asignar_agente' });
    expect(rule).not.toHaveProperty('params');
  });

  it('devuelve null si la regla no existe en el negocio', async () => {
    store.config = { rules: [waRule] };
    expect(await updateWorkflow(BIZ, 'otra', { activo: false })).toBeNull();
  });
});
