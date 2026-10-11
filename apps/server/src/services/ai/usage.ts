/**
 * FinOps de IA: agrega el consumo de tokens del bot por negocio.
 *
 * El consumo real se guarda en `message.metadata.usage` (lo registra el chatbot
 * a partir del `usage` que devuelven los SDKs). Acá lo agregamos con una query
 * SQL que SUMA en la base (no traemos todos los mensajes a memoria), scopeada por
 * negocio vía la conversación. El costo es una ESTIMACIÓN con precios de lista
 * públicos por modelo (pueden cambiar; es orientativo, no facturación real).
 */
import { prisma } from '../../lib/prisma';

/** Precio de lista público aproximado, USD por 1M de tokens (input/output). */
interface Price { in: number; out: number; }
const PRICING: Record<string, Price> = {
  // Claves genéricas (matchean cualquier variante, p. ej. claude-3-opus) y
  // específicas (ganan por ser el prefijo más largo cuando ambas matchean).
  'sonnet': { in: 3, out: 15 },
  'opus': { in: 15, out: 75 },
  'haiku': { in: 0.8, out: 4 },
  'claude-sonnet': { in: 3, out: 15 },
  'claude-3-5-sonnet': { in: 3, out: 15 },
  'claude-3-5-haiku': { in: 0.8, out: 4 },
  'claude-opus': { in: 15, out: 75 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'gpt-4o': { in: 2.5, out: 10 },
  'gpt-4.1': { in: 2, out: 8 },
  'gpt-4-turbo': { in: 10, out: 30 },
  'grok-4': { in: 5, out: 15 },
  'grok-2': { in: 2, out: 10 },
  'gemini': { in: 0.5, out: 1.5 },
};
/** Precio por defecto cuando el modelo no está en la tabla (conservador). */
const DEFAULT_PRICE: Price = { in: 1, out: 3 };

function priceFor(model: string): Price {
  const m = model.toLowerCase();
  // Coincidencia por el prefijo más largo que matchee (ej: 'claude-3-5-sonnet'
  // gana sobre 'claude-sonnet' si ambos aparecieran). Simple y suficiente.
  let best: Price | undefined;
  let bestLen = -1;
  for (const [key, price] of Object.entries(PRICING)) {
    if (m.includes(key) && key.length > bestLen) { best = price; bestLen = key.length; }
  }
  return best ?? DEFAULT_PRICE;
}

/** Costo estimado en USD de un volumen de tokens para un modelo. */
export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = priceFor(model);
  return (inputTokens / 1_000_000) * p.in + (outputTokens / 1_000_000) * p.out;
}

export interface UsageByModel {
  model: string;
  inputTokens: number;
  outputTokens: number;
  messages: number;
  estimatedCostUsd: number;
}
export interface UsageByDay {
  day: string; // YYYY-MM-DD
  inputTokens: number;
  outputTokens: number;
  messages: number;
  estimatedCostUsd: number;
}
export interface UsageSummary {
  rangeDays: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalMessages: number;
  estimatedCostUsd: number;
  byDay: UsageByDay[];
  byModel: UsageByModel[];
}

/**
 * Fila cruda de la query. Ojo: SUM(bigint) en Postgres devuelve `numeric`, que
 * Prisma entrega como Decimal (objeto), y COUNT(*) como bigint. Los normalizamos
 * con Number() al agregarlos, así que tipamos amplio.
 */
interface Row {
  day: string;
  model: string;
  input_tokens: bigint | number | string | { toString(): string };
  output_tokens: bigint | number | string | { toString(): string };
  messages: bigint | number | string | { toString(): string };
}

/**
 * Resumen de consumo de IA del negocio en los últimos `days` días.
 * Agrega por día y por modelo, con costo estimado. Scopeado por businessId.
 */
export async function getUsageSummary(businessId: string, days = 30): Promise<UsageSummary> {
  const rangeDays = Math.min(Math.max(Math.trunc(days) || 30, 1), 365);
  const since = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);

  // SUM en la base (no cargamos los mensajes en memoria). Scope por negocio vía
  // la conversación; solo mensajes del bot con usage registrado.
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT
      to_char(date_trunc('day', m."createdAt"), 'YYYY-MM-DD') AS day,
      COALESCE(m.metadata->'usage'->>'model', 'desconocido') AS model,
      COALESCE(SUM(CASE WHEN jsonb_typeof(m.metadata->'usage'->'inputTokens') = 'number'
                        THEN (m.metadata->'usage'->>'inputTokens')::bigint ELSE 0 END), 0) AS input_tokens,
      COALESCE(SUM(CASE WHEN jsonb_typeof(m.metadata->'usage'->'outputTokens') = 'number'
                        THEN (m.metadata->'usage'->>'outputTokens')::bigint ELSE 0 END), 0) AS output_tokens,
      COUNT(*) AS messages
    FROM messages m
    JOIN conversations c ON c.id = m."conversationId"
    WHERE c."businessId" = ${businessId}
      AND m.role = 'BOT'
      AND m.metadata -> 'usage' IS NOT NULL
      AND m."createdAt" >= ${since}
    GROUP BY day, model
    ORDER BY day ASC
  `;

  const byDayMap = new Map<string, UsageByDay>();
  const byModelMap = new Map<string, UsageByModel>();
  let totalInput = 0;
  let totalOutput = 0;
  let totalMessages = 0;
  let totalCost = 0;

  for (const r of rows) {
    const input = Number(r.input_tokens);
    const output = Number(r.output_tokens);
    const messages = Number(r.messages);
    const cost = estimateCostUsd(r.model, input, output);

    totalInput += input;
    totalOutput += output;
    totalMessages += messages;
    totalCost += cost;

    const d = byDayMap.get(r.day) ?? { day: r.day, inputTokens: 0, outputTokens: 0, messages: 0, estimatedCostUsd: 0 };
    d.inputTokens += input;
    d.outputTokens += output;
    d.messages += messages;
    d.estimatedCostUsd += cost;
    byDayMap.set(r.day, d);

    const m = byModelMap.get(r.model) ?? { model: r.model, inputTokens: 0, outputTokens: 0, messages: 0, estimatedCostUsd: 0 };
    m.inputTokens += input;
    m.outputTokens += output;
    m.messages += messages;
    m.estimatedCostUsd += cost;
    byModelMap.set(r.model, m);
  }

  const round = (n: number) => Math.round(n * 10000) / 10000;
  const byDay = [...byDayMap.values()].map((d) => ({ ...d, estimatedCostUsd: round(d.estimatedCostUsd) }));
  const byModel = [...byModelMap.values()]
    .map((m) => ({ ...m, estimatedCostUsd: round(m.estimatedCostUsd) }))
    .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);

  return {
    rangeDays,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    totalMessages,
    estimatedCostUsd: round(totalCost),
    byDay,
    byModel,
  };
}
