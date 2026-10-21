/**
 * Pruebas del loop agéntico de Mr Go (`services/mrgo/agent-loop.ts`):
 * encadenado de tools con realimentación del resultado, gating por rol, tope de
 * pasos, modos dry_run/live (externa en live pausa por confirmación), degradación
 * sin motor y parseo robusto.
 *
 * Mockeamos el motor de IA (provider con respuestas scripteadas), el executor
 * (executeAction + actionKind) y Prisma (para loadAgents/loadMemory → defaults,
 * todos los agentes activos). El GATING por rol usa el catálogo REAL.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    connection: { findFirst: vi.fn(async () => null) },
  },
}));

vi.mock('../../services/ai/engine', () => ({
  getAIProviderForBusiness: vi.fn(),
}));

vi.mock('../../services/actions/executor', () => ({
  executeAction: vi.fn(),
  actionKind: vi.fn(),
}));

import { getAIProviderForBusiness } from '../../services/ai/engine';
import { executeAction, actionKind } from '../../services/actions/executor';
import { runAgentLoop } from '../../services/mrgo/agent-loop';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

/** Provider con una secuencia de respuestas (repite la última si se piden más). */
function providerWith(responses: string[]) {
  let i = 0;
  const generateResponse = vi.fn(async () => responses[Math.min(i++, responses.length - 1)]);
  return { provider: { name: 'mock', generateResponse }, generateResponse };
}

/** Kind por tool (lo real: internas vs externas). */
const KIND: Record<string, 'interno' | 'externo'> = {
  crear_cliente: 'interno',
  mover_lifecycle: 'interno',
  enviar_whatsapp: 'externo',
  generar_link_pago: 'externo',
  crear_reserva: 'externo',
  lanzar_campana: 'externo',
};

function okResult(action: string, status = 'ejecutado') {
  return { action, kind: KIND[action] ?? 'externo', ok: status !== 'error', status, detail: `${action}: ${status}` };
}

beforeEach(() => {
  vi.clearAllMocks();
  mock(actionKind).mockImplementation((a: string) => KIND[a]);
  mock(executeAction).mockImplementation(async ({ action, mode }: { action: string; mode: string }) =>
    okResult(action, KIND[action] === 'externo' && mode !== 'live' ? 'simulado' : 'ejecutado'),
  );
});

describe('services/mrgo/agent-loop', () => {
  it('encadena dos tools realimentando el resultado y termina con la respuesta final', async () => {
    const { provider, generateResponse } = providerWith([
      '{"action":"tool","tool":"crear_cliente","toolParams":{"name":"Ana","email":"ana@mail.com"},"thought":"la registro"}',
      '{"action":"tool","tool":"mover_lifecycle","toolParams":{"clientId":"c1","stage":"HOT"}}',
      '{"action":"final","message":"Creé a Ana y la marqué como HOT.","emotion":"entusiasmo"}',
    ]);
    mock(getAIProviderForBusiness).mockResolvedValue(provider);

    const res = await runAgentLoop({ businessId: 'biz_1', text: 'Registrá a Ana y pasala a HOT', mode: 'dry_run' });

    expect(res.stoppedReason).toBe('final');
    expect(res.steps.map((s) => s.tool)).toEqual(['crear_cliente', 'mover_lifecycle']);
    expect(res.finalMessage).toContain('Ana');
    expect(res.emotion).toBe('entusiasmo');
    expect(executeAction).toHaveBeenCalledTimes(2);
    // 3 turnos del modelo: 2 tools + el final.
    expect(generateResponse).toHaveBeenCalledTimes(3);
    // La 2da llamada ya recibe en el history la observación del 1er resultado.
    const calls = generateResponse.mock.calls as unknown as unknown[][];
    const secondCallPrompt = calls[1][0] as string;
    expect(secondCallPrompt).toContain('RESULTADO de crear_cliente');
  });

  it('respeta el gating por rol: un tool fuera de la caja del agente no se ejecuta', async () => {
    const { provider } = providerWith([
      // soporte sólo puede enviar_whatsapp; crear_reserva está vedado.
      '{"action":"tool","tool":"crear_reserva","toolParams":{}}',
      '{"action":"final","message":"No puedo agendar desde soporte.","emotion":"neutral"}',
    ]);
    mock(getAIProviderForBusiness).mockResolvedValue(provider);

    const res = await runAgentLoop({ businessId: 'biz_1', text: 'Agendame un turno', agentKey: 'soporte' });

    expect(res.agent).toBe('soporte');
    expect(res.stoppedReason).toBe('final');
    expect(res.steps).toHaveLength(0);
    expect(executeAction).not.toHaveBeenCalled();
  });

  it('corta por maxSteps si el modelo nunca cierra', async () => {
    const { provider } = providerWith([
      '{"action":"tool","tool":"crear_cliente","toolParams":{"name":"X","email":"x@x.com"}}',
    ]); // siempre propone el mismo tool, nunca final
    mock(getAIProviderForBusiness).mockResolvedValue(provider);

    const res = await runAgentLoop({ businessId: 'biz_1', text: 'hacé algo', mode: 'dry_run', maxSteps: 2 });

    expect(res.stoppedReason).toBe('max_steps');
    expect(res.steps).toHaveLength(2);
    expect(executeAction).toHaveBeenCalledTimes(2);
  });

  it('en dry_run una acción externa se SIMULA y el loop sigue', async () => {
    const { provider } = providerWith([
      '{"action":"tool","tool":"enviar_whatsapp","toolParams":{"to":"+549111","body":"hola"}}',
      '{"action":"final","message":"Mensaje simulado.","emotion":"neutral"}',
    ]);
    mock(getAIProviderForBusiness).mockResolvedValue(provider);

    const res = await runAgentLoop({ businessId: 'biz_1', text: 'mandá un whatsapp', mode: 'dry_run' });

    expect(res.stoppedReason).toBe('final');
    expect(res.steps).toHaveLength(1);
    expect(res.steps[0]?.result.status).toBe('simulado');
    expect(executeAction).toHaveBeenCalledTimes(1);
  });

  it('en live una acción externa PAUSA el loop esperando confirmación (no ejecuta)', async () => {
    const { provider } = providerWith([
      '{"action":"tool","tool":"generar_link_pago","toolParams":{"amount":5000,"title":"Seña"}}',
    ]);
    mock(getAIProviderForBusiness).mockResolvedValue(provider);

    const res = await runAgentLoop({ businessId: 'biz_1', text: 'cobrale la seña', mode: 'live' });

    expect(res.stoppedReason).toBe('needs_confirmation');
    expect(res.pending?.tool).toBe('generar_link_pago');
    expect(res.pending?.kind).toBe('externo');
    expect(res.steps).toHaveLength(0);
    expect(executeAction).not.toHaveBeenCalled();
  });

  it('en live una acción INTERNA se ejecuta sin confirmación', async () => {
    const { provider } = providerWith([
      '{"action":"tool","tool":"mover_lifecycle","toolParams":{"clientId":"c1","stage":"CUSTOMER"}}',
      '{"action":"final","message":"Listo.","emotion":"neutral"}',
    ]);
    mock(getAIProviderForBusiness).mockResolvedValue(provider);

    const res = await runAgentLoop({ businessId: 'biz_1', text: 'pasá c1 a cliente', mode: 'live' });

    expect(res.stoppedReason).toBe('final');
    expect(res.steps).toHaveLength(1);
    expect(res.steps[0]?.tool).toBe('mover_lifecycle');
    expect(executeAction).toHaveBeenCalledTimes(1);
  });

  it('degrada a no_engine si el motor de IA no está disponible', async () => {
    mock(getAIProviderForBusiness).mockRejectedValue(new Error('sin key'));

    const res = await runAgentLoop({ businessId: 'biz_1', text: 'hola' });

    expect(res.stoppedReason).toBe('no_engine');
    expect(res.steps).toHaveLength(0);
  });

  it('tolera una respuesta no-JSON y se recupera pidiendo el formato', async () => {
    const { provider, generateResponse } = providerWith([
      'perdón, no entendí bien',
      '{"action":"final","message":"Ok, decime más.","emotion":"neutral"}',
    ]);
    mock(getAIProviderForBusiness).mockResolvedValue(provider);

    const res = await runAgentLoop({ businessId: 'biz_1', text: 'algo' });

    expect(res.stoppedReason).toBe('final');
    expect(res.steps).toHaveLength(0);
    expect(generateResponse).toHaveBeenCalledTimes(2);
  });

  it('devuelve empty sin llamar al motor si el texto vino vacío', async () => {
    const { provider, generateResponse } = providerWith(['{"action":"final","message":"x"}']);
    mock(getAIProviderForBusiness).mockResolvedValue(provider);

    const res = await runAgentLoop({ businessId: 'biz_1', text: '   ' });

    expect(res.stoppedReason).toBe('empty');
    expect(generateResponse).not.toHaveBeenCalled();
  });
});
