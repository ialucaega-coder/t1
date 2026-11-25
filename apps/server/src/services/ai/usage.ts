/**
 * FinOps de IA: agrega el consumo de tokens del bot por negocio.
 *
 * El consumo real se guarda en `message.metadata.usage` (lo registra el chatbot
 * a partir del `usage` que devuelven los SDKs). Acá lo agregamos con una query
 * SQL que SUMA en la base (no traemos todos los mensajes a memoria), scopeada por
 * negocio vía la conversación. El costo es una ESTIMACIÓN con precios de lista
 * públicos por modelo (pueden cambiar; es orientativo, no facturación real).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { cache, cacheKey } from '../../lib/cache';
import { lockSingleton } from '../../lib/singletonLock';
import type { TokenUsage } from './provider';

/**
 * Precio APROXIMADO en USD por 1M de tokens (input/output). Son estimaciones para
 * mostrar consumo, no facturación: los precios de la familia Claude 5 no están
 * verificados contra la lista oficial (se usan los de la generación anterior por
 * familia). Revisar contra la página de precios del proveedor antes de cobrar con esto.
 */
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

/**
 * Ventana del mes calendario en hora de Argentina (UTC-3 fijo, igual que analytics).
 * `month` es 'YYYY-MM' y `since` el instante UTC en que arrancó el mes allá.
 */
export function currentMonthWindow(now: Date = new Date()): { month: string; since: Date } {
  const ar = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const y = ar.getUTCFullYear();
  const m = ar.getUTCMonth();
  return { month: `${y}-${String(m + 1).padStart(2, '0')}`, since: new Date(Date.UTC(y, m, 1, 3)) };
}

interface SpendRow {
  businessId?: string;
  model: string;
  input_tokens: bigint | number | string | { toString(): string };
  output_tokens: bigint | number | string | { toString(): string };
}

// ────────────────────────────────────────────────────────────────
// Libro de gasto de IA FUERA del chatbot
//
// El gasto del bot de chat sale de `messages.metadata.usage`. El resto de las
// llamadas al modelo (copiloto, lead score, analista, agentes de Mr Go) no
// generan mensajes BOT, así que antes no contaban para el tope mensual. Lo
// registramos acá: una `Connection` (type 'AI_SPEND_LEDGER') por negocio con
//   { months: { 'YYYY-MM': { costUsd, bySource: { [fuente]: costUsd } } } }
// sin tablas nuevas. El read-modify-write va en una transacción con advisory lock
// (mismo patrón que el tope), así llamadas concurrentes no se pisan.
// ────────────────────────────────────────────────────────────────

const LEDGER_TYPE = 'AI_SPEND_LEDGER';
/** Meses que se conservan en el libro (el tope es mensual; el resto se poda). */
const LEDGER_KEEP_MONTHS = 3;

interface LedgerMonth { costUsd: number; bySource: Record<string, number> }
interface LedgerConfig { months: Record<string, LedgerMonth> }

function parseLedger(raw: unknown): LedgerConfig {
  const out: LedgerConfig = { months: {} };
  const months = (raw && typeof raw === 'object' ? (raw as { months?: unknown }).months : undefined);
  if (!months || typeof months !== 'object') return out;
  for (const [month, value] of Object.entries(months as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}$/.test(month) || !value || typeof value !== 'object') continue;
    const v = value as { costUsd?: unknown; bySource?: unknown };
    const costUsd = typeof v.costUsd === 'number' && Number.isFinite(v.costUsd) && v.costUsd > 0 ? v.costUsd : 0;
    const bySource: Record<string, number> = {};
    if (v.bySource && typeof v.bySource === 'object') {
      for (const [src, n] of Object.entries(v.bySource as Record<string, unknown>)) {
        if (typeof n === 'number' && Number.isFinite(n) && n > 0) bySource[src] = n;
      }
    }
    out.months[month] = { costUsd, bySource };
  }
  return out;
}

/** Instante UTC en que arranca el mes 'YYYY-MM' en Argentina (UTC-3 fijo). */
function monthStart(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return Date.UTC(y, m - 1, 1, 3);
}

/** Lo que `recordAiSpend` acepta: el `usage` de tokens del proveedor, o un costo ya calculado. */
export type AiSpendInput = TokenUsage | { costUsd: number };

/**
 * Registra gasto de IA que NO sale del chatbot, para que cuente en el tope mensual
 * (`getSpendSince` / `enforceSpendCap`).
 *
 *   recordAiSpend(businessId, usage | { costUsd }, source)
 *
 *  - `usage`: el `TokenUsage` que el proveedor entrega por `recordUsage` (se
 *    estima el costo con la tabla de precios de este módulo); o `{ costUsd }` si el
 *    caller ya lo calculó.
 *  - `source`: etiqueta libre del origen ('copilot', 'lead-score', 'analysis',
 *    'mrgo', ...). Se acumula por fuente dentro del mes.
 *
 * Nunca lanza (el gasto de IA no puede romper la feature que lo origina): ante un
 * error lo loguea y sigue. Montos nulos, negativos o no finitos se ignoran.
 */
export async function recordAiSpend(businessId: string, spend: AiSpendInput, source: string): Promise<void> {
  try {
    const cost =
      'costUsd' in spend
        ? spend.costUsd
        : estimateCostUsd(spend.model ?? 'desconocido', spend.inputTokens ?? 0, spend.outputTokens ?? 0);
    if (!Number.isFinite(cost) || cost <= 0) return;

    const { month } = currentMonthWindow();
    const src = (source || 'otros').slice(0, 60);

    await prisma.$transaction(async (tx) => {
      await lockSingleton(tx, businessId, LEDGER_TYPE);
      const conn = await tx.connection.findFirst({
        where: { businessId, type: LEDGER_TYPE },
        select: { id: true, config: true },
        orderBy: { id: 'asc' },
      });
      const ledger = parseLedger(conn?.config);
      const cur = ledger.months[month] ?? { costUsd: 0, bySource: {} };
      cur.costUsd += cost;
      cur.bySource[src] = (cur.bySource[src] ?? 0) + cost;
      ledger.months[month] = cur;
      // Poda: solo los últimos meses.
      const keep = Object.keys(ledger.months).sort().slice(-LEDGER_KEEP_MONTHS);
      for (const k of Object.keys(ledger.months)) if (!keep.includes(k)) delete ledger.months[k];

      const json = ledger as unknown as Prisma.InputJsonObject;
      if (conn) {
        await tx.connection.update({ where: { id: conn.id }, data: { config: json } });
      } else {
        await tx.connection.create({
          data: { name: 'Gasto de IA (fuera del chat)', type: LEDGER_TYPE, icon: 'Gauge', config: json, isActive: false, businessId },
        });
      }
    });
    // El estado del tope está cacheado 30 s: que el próximo chequeo vea este gasto.
    cache.invalidate(cacheKey(businessId, 'ai-spend'));
  } catch (err) {
    console.error('No se pudo registrar el gasto de IA:', (err as Error).message);
  }
}

/** Gasto (USD) registrado en el libro desde `since` (meses cuyo inicio es >= since). */
async function getLedgerSpendSince(businessId: string, since: Date): Promise<number> {
  const conn = await prisma.connection.findFirst({
    where: { businessId, type: LEDGER_TYPE },
    select: { config: true },
    orderBy: { id: 'asc' },
  });
  const ledger = parseLedger(conn?.config);
  let total = 0;
  for (const [month, value] of Object.entries(ledger.months)) {
    if (monthStart(month) >= since.getTime()) total += value.costUsd;
  }
  return total;
}

/** Gasto estimado (USD) del negocio desde `since`: respuestas del bot con usage + libro fuera del chat. */
export async function getSpendSince(businessId: string, since: Date): Promise<number> {
  const [chat, other] = await Promise.all([getChatSpendSince(businessId, since), getLedgerSpendSince(businessId, since)]);
  return chat + other;
}

/** Solo respuestas del bot de chat con usage (messages.metadata.usage). */
async function getChatSpendSince(businessId: string, since: Date): Promise<number> {
  const rows = await prisma.$queryRaw<SpendRow[]>`
    SELECT
      COALESCE(m.metadata->'usage'->>'model', 'desconocido') AS model,
      COALESCE(SUM(CASE WHEN jsonb_typeof(m.metadata->'usage'->'inputTokens') = 'number'
                        THEN (m.metadata->'usage'->>'inputTokens')::bigint ELSE 0 END), 0) AS input_tokens,
      COALESCE(SUM(CASE WHEN jsonb_typeof(m.metadata->'usage'->'outputTokens') = 'number'
                        THEN (m.metadata->'usage'->>'outputTokens')::bigint ELSE 0 END), 0) AS output_tokens
    FROM messages m
    JOIN conversations c ON c.id = m."conversationId"
    WHERE c."businessId" = ${businessId}
      AND m.role = 'BOT'
      AND m.metadata -> 'usage' IS NOT NULL
      AND m."createdAt" >= ${since}
    GROUP BY model
  `;
  let total = 0;
  for (const r of rows) total += estimateCostUsd(r.model, Number(r.input_tokens), Number(r.output_tokens));
  return total;
}

/** Gasto estimado (USD) por negocio desde `since` (para el panel del Super Admin). */
export async function getSpendByBusinessSince(since: Date): Promise<Map<string, number>> {
  const out = await getChatSpendByBusinessSince(since);
  const ledgers = await prisma.connection.findMany({
    where: { type: LEDGER_TYPE },
    select: { businessId: true, config: true },
  });
  for (const row of ledgers) {
    const ledger = parseLedger(row.config);
    let total = 0;
    for (const [month, value] of Object.entries(ledger.months)) {
      if (monthStart(month) >= since.getTime()) total += value.costUsd;
    }
    if (total > 0) out.set(row.businessId, (out.get(row.businessId) ?? 0) + total);
  }
  return out;
}

async function getChatSpendByBusinessSince(since: Date): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<SpendRow[]>`
    SELECT
      c."businessId" AS "businessId",
      COALESCE(m.metadata->'usage'->>'model', 'desconocido') AS model,
      COALESCE(SUM(CASE WHEN jsonb_typeof(m.metadata->'usage'->'inputTokens') = 'number'
                        THEN (m.metadata->'usage'->>'inputTokens')::bigint ELSE 0 END), 0) AS input_tokens,
      COALESCE(SUM(CASE WHEN jsonb_typeof(m.metadata->'usage'->'outputTokens') = 'number'
                        THEN (m.metadata->'usage'->>'outputTokens')::bigint ELSE 0 END), 0) AS output_tokens
    FROM messages m
    JOIN conversations c ON c.id = m."conversationId"
    WHERE m.role = 'BOT'
      AND m.metadata -> 'usage' IS NOT NULL
      AND m."createdAt" >= ${since}
    GROUP BY c."businessId", model
  `;
  const out = new Map<string, number>();
  for (const r of rows) {
    if (!r.businessId) continue;
    out.set(r.businessId, (out.get(r.businessId) ?? 0) + estimateCostUsd(r.model, Number(r.input_tokens), Number(r.output_tokens)));
  }
  return out;
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
