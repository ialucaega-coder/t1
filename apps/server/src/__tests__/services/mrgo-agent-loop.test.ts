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

vi.mock('../../services/ai/usage', () => ({ recordAiSpend: vi.fn(async () => undefined) }));
vi.mock('../../services/ai/spendCap', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/ai/spendCap')>();
  return { ...actual, enforceSpendCap: vi.fn(async () => undefined) };
});
vi.mock('../../services/mrgo/office', () => ({ loadOffice: vi.fn(async () => ({ paused: [], positions: {} })) }));

vi.mock('../../services/actions/executor', () => ({
  executeAction: vi.fn(),
  actionKind: vi.fn(),
}));

import { getAIProviderForBusiness } from '../../services/ai/engine';
import { recordAiSpend } from '../../services/ai/usage';
import { enforceSpendCap, SpendCapError } from '../../services/ai/spendCap';
import { loadOffice } from '../../services/mrgo/office';
import { executeAction, actionKind, type ActionResult } from '../../services/actions/executor';
import { runAgentLoop, resumeAgentLoop } from '../../services/mrgo/agent-loop';

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

function okResult(action: string, status: ActionResult['status'] = 'ejecutado'): ActionResult {
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

describe('services/mrgo/agent-loop — resumeAgentLoop', () => {
  it('ejecuta la acción confirmada EN VIVO y CONTINÚA la cadena hasta cerrar', async () => {
    // Tras confirmar el link de pago, el modelo cierra con un final.
    const { provider, generateResponse } = providerWith([
      '{"action":"final","message":"Listo, generé el link.","emotion":"entusiasmo"}',
    ]);
    mock(getAIProviderForBusiness).mockResolvedValue(provider);

    const res = await resumeAgentLoop({
      businessId: 'biz_1',
      text: 'cobrale la seña',
      agentKey: 'ventas',
      confirmed: { tool: 'generar_link_pago', params: { amount: 5000, title: 'Seña' } },
    });

    expect(res.stoppedReason).toBe('final');
    expect(res.steps.map((s) => s.tool)).toEqual(['generar_link_pago']);
    // La acción confirmada se ejecutó en vivo (no simulada).
    expect(res.steps[0]?.result.status).toBe('ejecutado');
    expect(executeAction).toHaveBeenCalledTimes(1);
    expect(executeAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'generar_link_pago', mode: 'live' }),
    );
    // El modelo recibió como primer prompt la observación de la acción confirmada.
    const firstPrompt = (generateResponse.mock.calls as unknown as unknown[][])[0][0] as string;
    expect(firstPrompt).toContain('RESULTADO de generar_link_pago');
  });

  it('reconstruye los pasos previos y los incluye en la traza final', async () => {
    const { provider } = providerWith(['{"action":"final","message":"Cobré y avisé.","emotion":"neutral"}']);
    mock(getAIProviderForBusiness).mockResolvedValue(provider);

    const res = await resumeAgentLoop({
      businessId: 'biz_1',
      text: 'cobrá y avisá',
      agentKey: 'ventas',
      priorSteps: [
        { tool: 'crear_cliente', params: { name: 'Ana' }, result: okResult('crear_cliente') },
      ],
      confirmed: { tool: 'generar_link_pago', params: { amount: 5000 } },
    });

    expect(res.stoppedReason).toBe('final');
    expect(res.steps.map((s) => s.tool)).toEqual(['crear_cliente', 'generar_link_pago']);
    // Sólo se EJECUTA la acción confirmada; el paso previo es contexto (no re-ejecuta).
    expect(executeAction).toHaveBeenCalledTimes(1);
  });

  it('si la continuación propone OTRA acción externa en live, vuelve a PAUSAR', async () => {
    const { provider } = providerWith([
      '{"action":"tool","tool":"enviar_whatsapp","toolParams":{"body":"ya te paso el link"}}',
    ]);
    mock(getAIProviderForBusiness).mockResolvedValue(provider);

    const res = await resumeAgentLoop({
      businessId: 'biz_1',
      text: 'cobrá y avisá',
      agentKey: 'ventas',
      confirmed: { tool: 'generar_link_pago', params: { amount: 5000 } },
    });

    expect(res.stoppedReason).toBe('needs_confirmation');
    expect(res.pending?.tool).toBe('enviar_whatsapp');
    // La confirmada se ejecutó; la nueva externa quedó pendiente (no se ejecutó).
    expect(res.steps.map((s) => s.tool)).toEqual(['generar_link_pago']);
    expect(executeAction).toHaveBeenCalledTimes(1);
  });

  it('sin motor de IA: ejecuta la confirmada igual pero no continúa (no_engine)', async () => {
    mock(getAIProviderForBusiness).mockRejectedValue(new Error('sin key'));

    const res = await resumeAgentLoop({
      businessId: 'biz_1',
      text: 'cobrale',
      agentKey: 'ventas',
      confirmed: { tool: 'generar_link_pago', params: { amount: 5000 } },
    });

    expect(res.stoppedReason).toBe('no_engine');
    expect(res.steps.map((s) => s.tool)).toEqual(['generar_link_pago']);
    expect(executeAction).toHaveBeenCalledTimes(1);
  });

  it('rechaza una acción confirmada fuera de la caja del agente (no ejecuta)', async () => {
    const { provider, generateResponse } = providerWith(['{"action":"final","message":"x"}']);
    mock(getAIProviderForBusiness).mockResolvedValue(provider);

    // soporte no puede generar_link_pago.
    const res = await resumeAgentLoop({
      businessId: 'biz_1',
      text: 'cobrale',
      agentKey: 'soporte',
      confirmed: { tool: 'generar_link_pago', params: { amount: 5000 } },
    });

    expect(res.stoppedReason).toBe('final');
    expect(res.steps).toHaveLength(0);
    expect(executeAction).not.toHaveBeenCalled();
    expect(generateResponse).not.toHaveBeenCalled();
  });
});

describe('services/mrgo/agent-loop: gasto de IA, tope y pausas', () => {
  const finalJson = '{"action":"final","message":"Listo","emotion":"neutral"}';

  it('registra el gasto de CADA llamada al modelo (recordUsage -> recordAiSpend, fuente mrgo)', async () => {
    const usage1 = { inputTokens: 100, outputTokens: 20, model: 'claude-sonnet-5' };
    const usage2 = { inputTokens: 150, outputTokens: 10, model: 'claude-sonnet-5' };
    const usages = [usage1, usage2];
    let i = 0;
    const responses = ['{"action":"tool","tool":"crear_cliente","toolParams":{"name":"Ana","email":"a@x.com"}}', finalJson];
    const generateResponse = vi.fn(async (_p: string, ctx: { recordUsage?: (u: typeof usage1) => void }) => {
      ctx.recordUsage?.(usages[i]);
      return responses[i++];
    });
    mock(getAIProviderForBusiness).mockResolvedValue({ name: 'mock', generateResponse });

    await runAgentLoop({ businessId: 'biz_1', text: 'creá a Ana' });

    expect(recordAiSpend).toHaveBeenCalledTimes(2);
    expect(recordAiSpend).toHaveBeenNthCalledWith(1, 'biz_1', usage1, 'mrgo');
    expect(recordAiSpend).toHaveBeenNthCalledWith(2, 'biz_1', usage2, 'mrgo');
  });

  it('si el proveedor no informa usage no registra gasto', async () => {
    const { provider } = providerWith([finalJson]);
    mock(getAIProviderForBusiness).mockResolvedValue(provider);
    await runAgentLoop({ businessId: 'biz_1', text: 'hola' });
    expect(recordAiSpend).not.toHaveBeenCalled();
  });

  it('el tope se chequea ANTES de cada llamada: si se alcanza a mitad del loop, corta con un mensaje claro', async () => {
    const { provider, generateResponse } = providerWith([
      '{"action":"tool","tool":"crear_cliente","toolParams":{"name":"Ana","email":"a@x.com"}}',
      finalJson,
    ]);
    mock(getAIProviderForBusiness).mockResolvedValue(provider);
    // 1ª llamada ok; en la 2ª ya se llegó al tope.
    mock(enforceSpendCap).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new SpendCapError(25));

    const res = await runAgentLoop({ businessId: 'biz_1', text: 'creá a Ana' });

    expect(generateResponse).toHaveBeenCalledTimes(1);
    expect(res.stoppedReason).toBe('no_engine');
    expect(res.finalMessage).toContain('tope mensual de gasto de IA');
    expect(res.finalMessage).toContain('25');
    expect(res.steps).toHaveLength(1);
  });

  it('si el tope ya está alcanzado al resolver el proveedor, devuelve el mensaje del tope (no "motor no disponible")', async () => {
    mock(getAIProviderForBusiness).mockRejectedValue(new SpendCapError(10));

    const res = await runAgentLoop({ businessId: 'biz_1', text: 'hola' });

    expect(res.stoppedReason).toBe('no_engine');
    expect(res.finalMessage).toContain('tope mensual de gasto de IA');
  });

  it('un agente pausado desde la Oficina no corre el loop: se usa otro disponible', async () => {
    const { provider } = providerWith([finalJson]);
    mock(getAIProviderForBusiness).mockResolvedValue(provider);
    mock(loadOffice).mockResolvedValueOnce({ paused: ['ventas'], positions: {} });

    const res = await runAgentLoop({ businessId: 'biz_1', text: 'cobrá', agentKey: 'ventas' });

    expect(res.agent).not.toBe('ventas');
  });
});
