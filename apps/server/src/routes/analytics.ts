import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { cacheResponse } from '../middleware/cacheResponse';
import { validateQuery } from '../middleware/validate';
import { dateRangeQuerySchema, type DateRangeQuery } from '../validators/dateRange';
import { prisma } from '../lib/prisma';
import { getFunnel, type LifecycleStage } from '../services/clients/lifecycle';
import {
  ANALYTICS_TZ,
  arDayMonthLabel,
  arDayStartUtc,
  arWeekdayLabel,
} from '../services/analytics/time';
import { resolveRange, windowFilter, prevWindowFilter, type ResolvedRange } from '../services/analytics/range';

const router = Router();

/** Rango pedido por query (?days= | ?from=&to=), ya validado; undefined = comportamiento histórico. */
const rangeQuery = validateQuery(dateRangeQuerySchema);
const rangeOf = (req: { validatedQuery?: Record<string, unknown> }, defaultDays: number): ResolvedRange =>
  resolveRange(req.validatedQuery as DateRangeQuery | undefined, defaultDays);

/** Condición SQL de fecha (createdAt) para una ventana; vacía si no hay tope superior. */
const untilSql = (column: Prisma.Sql, range: ResolvedRange): Prisma.Sql =>
  range.until ? Prisma.sql`AND ${column} < ${range.until}` : Prisma.empty;

// Los endpoints de analytics agregan muchas filas por request: se cachean unos
// segundos por negocio (mismo criterio que /api/stats).
const ANALYTICS_TTL_MS = 30_000;

/**
 * CTE `base` con la atribución Click-to-WhatsApp de cada conversación del negocio
 * (`Conversation.metadata.attribution`, Json libre). Devuelve una fila por
 * conversación con `source`, `source_id` y `headline` ya normalizados (NULL si el
 * campo no es un string no vacío). El JSON se lee de forma tolerante: cualquier forma
 * inesperada produce NULL en vez de un error.
 */
export function attributionBase(
  businessId: string,
  source: Prisma.Sql = Prisma.raw('"conversations"'),
  range?: ResolvedRange,
): Prisma.Sql {
  // Solo se filtra por fecha si el cliente pidió un rango; sin rango cuenta todo el historial.
  const dateCond = range?.custom
    ? Prisma.sql`AND c."createdAt" >= ${range.since} ${untilSql(Prisma.raw('c."createdAt"'), range)}`
    : Prisma.empty;
  // Un campo vale solo si metadata y metadata.attribution son objetos y el campo es
  // un string no vacío tras recortar espacios (igual que la lectura tolerante previa).
  // `->` sobre algo que no es objeto devuelve NULL (no error), así que el CASE alcanza.
  const field = (name: 'source' | 'sourceId' | 'headline') =>
    Prisma.sql`CASE WHEN jsonb_typeof(c."metadata"->'attribution') = 'object'
                    AND jsonb_typeof(c."metadata"->'attribution'->${Prisma.raw(`'${name}'`)}) = 'string'
               THEN NULLIF(regexp_replace(c."metadata"->'attribution'->>${Prisma.raw(`'${name}'`)}, '^\\s+|\\s+$', '', 'g'), '')
               END`;
  return Prisma.sql`
    WITH base AS (
      SELECT ${field('source')} AS source,
             ${field('sourceId')} AS source_id,
             ${field('headline')} AS headline
      FROM ${source} c
      WHERE c."businessId" = ${businessId} ${dateCond}
    )`;
}

/** Etiquetas en español para cada etapa del embudo (orden de LIFECYCLE_STAGES). */
const STAGE_LABELS: Record<LifecycleStage, string> = {
  NEW: 'Nuevo',
  HOT: 'Caliente',
  PAYMENT: 'En pago',
  CUSTOMER: 'Cliente',
};

const COST_PER_1K_TOKENS = 0.003;
const AVG_TOKENS_PER_MESSAGE = 150;

router.get(
  '/kpi',
  requireAuth,
  rangeQuery,
  cacheResponse(ANALYTICS_TTL_MS),
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const range = rangeOf(req, 30);
    const inRange = windowFilter(range);
    const inPrev = prevWindowFilter(range);

    const [
      totalConversations, totalBookings, completedBookings, closedConvos, botMessages, avgResponseTime,
      prevConversations, prevBookings, prevCompleted, prevClosed, prevBotMessages, prevAvgResp,
    ] = await Promise.all([
      prisma.conversation.count({ where: { businessId, createdAt: inRange } }),
      prisma.booking.count({ where: { businessId, createdAt: inRange } }),
      prisma.booking.count({ where: { businessId, status: 'COMPLETED', createdAt: inRange } }),
      prisma.conversation.count({ where: { businessId, status: 'CLOSED', createdAt: inRange } }),
      prisma.message.count({ where: { role: 'BOT', createdAt: inRange, conversation: { businessId } } }),
      prisma.message.aggregate({
        where: { role: 'BOT', responseTime: { not: null }, createdAt: inRange, conversation: { businessId } },
        _avg: { responseTime: true },
      }),
      prisma.conversation.count({ where: { businessId, createdAt: inPrev } }),
      prisma.booking.count({ where: { businessId, createdAt: inPrev } }),
      prisma.booking.count({ where: { businessId, status: 'COMPLETED', createdAt: inPrev } }),
      prisma.conversation.count({ where: { businessId, status: 'CLOSED', createdAt: inPrev } }),
      prisma.message.count({ where: { role: 'BOT', createdAt: inPrev, conversation: { businessId } } }),
      prisma.message.aggregate({
        where: { role: 'BOT', responseTime: { not: null }, createdAt: inPrev, conversation: { businessId } },
        _avg: { responseTime: true },
      }),
    ]);

    function calcChange(curr: number, prev: number): number {
      return prev > 0 ? parseFloat(((curr - prev) / prev * 100).toFixed(1)) : 0;
    }

    function calcSatisfaction(closed: number, total: number, avgMs: number | null): number {
      const resRate = total > 0 ? closed / total : 0;
      const ms = avgMs || 0;
      const score = ms === 0 ? 5 : ms < 1000 ? 5 : ms < 3000 ? 4 : ms < 5000 ? 3 : ms < 10000 ? 2 : 1;
      return parseFloat(((resRate * 3 + score * 2) / 5).toFixed(1)) || 0;
    }

    const avgSatisfaction = calcSatisfaction(closedConvos, totalConversations, avgResponseTime._avg.responseTime);
    const prevSatisfaction = calcSatisfaction(prevClosed, prevConversations, prevAvgResp._avg.responseTime);

    const estimatedTokens = botMessages * AVG_TOKENS_PER_MESSAGE;
    const monthlyAiCost = parseFloat(((estimatedTokens / 1000) * COST_PER_1K_TOKENS).toFixed(2));
    const prevTokens = prevBotMessages * AVG_TOKENS_PER_MESSAGE;
    const prevAiCost = parseFloat(((prevTokens / 1000) * COST_PER_1K_TOKENS).toFixed(2));

    const conversionRate = totalBookings > 0 ? parseFloat(((completedBookings / totalBookings) * 100).toFixed(1)) : 0;
    const prevConversionRate = prevBookings > 0 ? parseFloat(((prevCompleted / prevBookings) * 100).toFixed(1)) : 0;

    res.json({
      totalConversations,
      conversationsChange: calcChange(totalConversations, prevConversations),
      avgSatisfaction,
      satisfactionChange: parseFloat((avgSatisfaction - prevSatisfaction).toFixed(1)),
      monthlyAiCost,
      aiCostChange: calcChange(monthlyAiCost, prevAiCost),
      conversionRate,
      conversionChange: parseFloat((conversionRate - prevConversionRate).toFixed(1)),
      monthlyBudget: 50,
      range: { from: range.keys[0], to: range.keys[range.keys.length - 1], days: range.days, custom: range.custom },
    });
  })
);

router.get(
  '/conversations',
  requireAuth,
  rangeQuery,
  cacheResponse(ANALYTICS_TTL_MS),
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;

    // Últimos 7 días calendario en hora de Argentina, agrupados EN LA DB: una
    // consulta que devuelve a lo sumo 7 filas (antes se traían todas las
    // conversaciones de la ventana a memoria).
    // Con ?days / ?from&to la ventana es la pedida (a lo sumo 366 filas); si no, 7 días.
    const range = rangeOf(req, 7);
    const keys = range.keys;
    const rows = await prisma.$queryRaw<{ day: string; n: number }[]>`
      SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${ANALYTICS_TZ}, 'YYYY-MM-DD') AS day,
             COUNT(*)::int AS n
      FROM "conversations"
      WHERE "businessId" = ${businessId} AND "createdAt" >= ${arDayStartUtc(keys[0])}
        ${untilSql(Prisma.raw('"createdAt"'), range)}
      GROUP BY 1`;
    const counts = new Map(rows.map((r) => [r.day, Number(r.n)]));

    // Con más de una semana el día de la semana se repite: ahí se rotula dd/mm (y la fecha ISO va en `date`).
    const label = keys.length > 7 ? arDayMonthLabel : arWeekdayLabel;
    res.json(keys.map((k) => ({ day: label(k), date: k, count: counts.get(k) ?? 0 })));
  })
);

router.get(
  '/satisfaction',
  requireAuth,
  rangeQuery,
  cacheResponse(ANALYTICS_TTL_MS),
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const range = rangeOf(req, 30);
    const inRange = windowFilter(range);

    const [closed, handoff, open, totalWithResponse, avgResp] = await Promise.all([
      prisma.conversation.count({ where: { businessId, status: 'CLOSED', createdAt: inRange } }),
      prisma.conversation.count({ where: { businessId, status: 'HANDOFF', createdAt: inRange } }),
      prisma.conversation.count({ where: { businessId, status: 'OPEN', createdAt: inRange } }),
      prisma.message.count({
        where: { role: 'BOT', responseTime: { not: null }, createdAt: inRange, conversation: { businessId } },
      }),
      prisma.message.aggregate({
        where: { role: 'BOT', responseTime: { not: null }, createdAt: inRange, conversation: { businessId } },
        _avg: { responseTime: true },
      }),
    ]);

    const total = closed + handoff + open;
    if (total === 0) {
      return res.json([
        { stars: 5, count: 0, color: '#22c55e' },
        { stars: 4, count: 0, color: '#84cc16' },
        { stars: 3, count: 0, color: '#eab308' },
        { stars: 2, count: 0, color: '#f97316' },
        { stars: 1, count: 0, color: '#ef4444' },
      ]);
    }

    const star5 = closed;
    const star4 = Math.round(open * 0.6);
    const star3 = Math.round(open * 0.4);
    const star2 = Math.round(handoff * 0.6);
    const star1 = Math.round(handoff * 0.4);

    res.json([
      { stars: 5, count: star5, color: '#22c55e' },
      { stars: 4, count: star4, color: '#84cc16' },
      { stars: 3, count: star3, color: '#eab308' },
      { stars: 2, count: star2, color: '#f97316' },
      { stars: 1, count: star1, color: '#ef4444' },
    ]);
  })
);

router.get(
  '/improvements',
  requireAuth,
  rangeQuery,
  cacheResponse(ANALYTICS_TTL_MS),
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const range = rangeOf(req, 30);
    const inRange = windowFilter(range);

    const [handoffCount, totalConvos, avgResp, botMsgCount, totalMsgCount, pendingBookings, totalBookings] = await Promise.all([
      prisma.conversation.count({ where: { businessId, status: 'HANDOFF', createdAt: inRange } }),
      prisma.conversation.count({ where: { businessId, createdAt: inRange } }),
      prisma.message.aggregate({
        where: { role: 'BOT', responseTime: { not: null }, createdAt: inRange, conversation: { businessId } },
        _avg: { responseTime: true },
      }),
      prisma.message.count({ where: { role: 'BOT', createdAt: inRange, conversation: { businessId } } }),
      prisma.message.count({ where: { createdAt: inRange, conversation: { businessId } } }),
      prisma.booking.count({ where: { businessId, status: 'PENDING', createdAt: inRange } }),
      prisma.booking.count({ where: { businessId, createdAt: inRange } }),
    ]);

    const improvements: { id: string; title: string; category: string; severity: string; description: string }[] = [];
    let idx = 1;

    const avgRespMs = avgResp._avg.responseTime || 0;
    if (avgRespMs > 3000) {
      improvements.push({
        id: String(idx++),
        title: 'Optimizar tiempo de respuesta del bot',
        category: 'Performance',
        severity: 'alta',
        description: `El tiempo promedio de respuesta es ${(avgRespMs / 1000).toFixed(1)}s. Se recomienda optimizar los prompts o usar un modelo más rápido.`,
      });
    }

    const handoffRate = totalConvos > 0 ? handoffCount / totalConvos : 0;
    if (handoffRate > 0.2) {
      improvements.push({
        id: String(idx++),
        title: 'Reducir tasa de escalamiento a humanos',
        category: 'Contenido',
        severity: 'alta',
        description: `El ${(handoffRate * 100).toFixed(0)}% de las conversaciones requiere intervención humana. Revisá los prompts y las habilidades del bot.`,
      });
    }

    const pendingRate = totalBookings > 0 ? pendingBookings / totalBookings : 0;
    if (pendingRate > 0.3) {
      improvements.push({
        id: String(idx++),
        title: 'Mejorar confirmación de reservas',
        category: 'UX',
        severity: 'media',
        description: `El ${(pendingRate * 100).toFixed(0)}% de las reservas están pendientes de confirmación. Considerá habilitar confirmación automática.`,
      });
    }

    const botRatio = totalMsgCount > 0 ? botMsgCount / totalMsgCount : 0;
    if (botRatio < 0.3 && totalMsgCount > 10) {
      improvements.push({
        id: String(idx++),
        title: 'Aumentar automatización de respuestas',
        category: 'Config',
        severity: 'media',
        description: `Solo el ${(botRatio * 100).toFixed(0)}% de los mensajes son del bot. Configurá más habilidades para aumentar la automatización.`,
      });
    }

    if (totalConvos === 0) {
      improvements.push({
        id: String(idx++),
        title: 'Activar un canal de comunicación',
        category: 'Config',
        severity: 'alta',
        description: 'No hay conversaciones registradas. Conectá WhatsApp, Telegram u otro canal para empezar a recibir clientes.',
      });
    }

    if (improvements.length === 0) {
      improvements.push({
        id: '1',
        title: 'Todo en orden',
        category: 'Info',
        severity: 'baja',
        description: `No se detectaron problemas significativos en ${range.custom ? "el período elegido" : "los últimos 30 días"}. ¡Buen trabajo!`,
      });
    }

    res.json(improvements);
  })
);

router.get(
  '/costs',
  requireAuth,
  rangeQuery,
  cacheResponse(ANALYTICS_TTL_MS),
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const range = rangeOf(req, 30);
    const inRange = windowFilter(range);

    // Sumamos el largo de los textos EN LA DB (SUM(LENGTH)) en vez de traer todos
    // los mensajes del bot a memoria: el findMany anterior crecía sin tope con el
    // volumen del negocio (memoria + transferencia O(mensajes)).
    const rows = await prisma.$queryRaw<{ total: bigint | null }[]>`
      SELECT COALESCE(SUM(LENGTH(m."text")), 0)::bigint AS total
      FROM "messages" m
      JOIN "conversations" c ON c."id" = m."conversationId"
      WHERE c."businessId" = ${businessId}
        AND m."role" = 'BOT'::"MessageRole"
        AND m."createdAt" >= ${range.since}
        ${untilSql(Prisma.raw('m."createdAt"'), range)}
    `;
    const totalChars = Number(rows[0]?.total ?? 0);
    const estimatedTokens = Math.round(totalChars / 4);

    const primaryTokens = Math.round(estimatedTokens * 0.7);
    const secondaryTokens = Math.round(estimatedTokens * 0.3);

    const primaryCost = parseFloat(((primaryTokens / 1000) * 0.003).toFixed(2));
    const secondaryCost = parseFloat(((secondaryTokens / 1000) * 0.0004).toFixed(2));

    res.json([
      { model: 'Claude Sonnet', tokens: primaryTokens, cost: primaryCost },
      { model: 'Claude Haiku', tokens: secondaryTokens, cost: secondaryCost },
    ]);
  })
);

router.get(
  '/metrics',
  requireAuth,
  rangeQuery,
  cacheResponse(ANALYTICS_TTL_MS),
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const range = rangeOf(req, 30);
    const inRange = windowFilter(range);

    const [avgResp, totalMessages, totalConvos, closedConvos, handoffConvos, botBookings] = await Promise.all([
      prisma.message.aggregate({
        where: { role: 'BOT', responseTime: { not: null }, createdAt: inRange, conversation: { businessId } },
        _avg: { responseTime: true },
      }),
      prisma.message.count({
        where: { createdAt: inRange, conversation: { businessId } },
      }),
      prisma.conversation.count({ where: { businessId, createdAt: inRange } }),
      prisma.conversation.count({ where: { businessId, status: 'CLOSED', createdAt: inRange } }),
      prisma.conversation.count({ where: { businessId, status: 'HANDOFF', createdAt: inRange } }),
      prisma.booking.count({ where: { businessId, source: { in: ['TELEGRAM', 'WHATSAPP'] }, createdAt: inRange } }),
    ]);

    const avgRespMs = avgResp._avg.responseTime || 0;
    const msgsPerConvo = totalConvos > 0 ? (totalMessages / totalConvos).toFixed(1) : '0';
    const resolutionRate = totalConvos > 0 ? ((closedConvos / totalConvos) * 100).toFixed(0) : '0';
    const handoffRate = totalConvos > 0 ? ((handoffConvos / totalConvos) * 100).toFixed(0) : '0';

    res.json([
      { label: 'Tiempo promedio de respuesta', value: avgRespMs > 0 ? `${(avgRespMs / 1000).toFixed(1)}s` : '—' },
      { label: 'Mensajes por conversación', value: msgsPerConvo },
      { label: 'Tasa de resolución', value: `${resolutionRate}%` },
      { label: 'Escalaciones a humano', value: `${handoffRate}%` },
      { label: 'Reservas por bot', value: String(botBookings) },
    ]);
  })
);

/**
 * Serie temporal de los últimos 14 días (estilo respond.io): por día, cuántas
 * conversaciones nuevas se crearon y cuántos mensajes se registraron. Ambas
 * métricas salen de `createdAt` (columnas que ya existen), así que es barato y
 * no toca el schema.
 *
 * Patrón anti-N+1: una sola consulta por tabla (igual que `/conversations`),
 * trayendo sólo `createdAt` de la ventana y agrupando por día en memoria. Scope
 * multi-tenant por `businessId`.
 */
router.get(
  '/timeseries',
  requireAuth,
  rangeQuery,
  cacheResponse(ANALYTICS_TTL_MS),
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;

    // 14 días calendario en hora de Argentina. Agrupado en la DB (una consulta por
    // tabla, a lo sumo 14 filas cada una); mensajes se acota por negocio vía JOIN.
    const range = rangeOf(req, 14);
    const keys = range.keys;
    const since = arDayStartUtc(keys[0]);
    const [convRows, msgRows] = await Promise.all([
      prisma.$queryRaw<{ day: string; n: number }[]>`
        SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${ANALYTICS_TZ}, 'YYYY-MM-DD') AS day,
               COUNT(*)::int AS n
        FROM "conversations"
        WHERE "businessId" = ${businessId} AND "createdAt" >= ${since}
          ${untilSql(Prisma.raw('"createdAt"'), range)}
        GROUP BY 1`,
      prisma.$queryRaw<{ day: string; n: number }[]>`
        SELECT to_char((m."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${ANALYTICS_TZ}, 'YYYY-MM-DD') AS day,
               COUNT(*)::int AS n
        FROM "messages" m
        JOIN "conversations" c ON c."id" = m."conversationId"
        WHERE c."businessId" = ${businessId} AND m."createdAt" >= ${since}
          ${untilSql(Prisma.raw('m."createdAt"'), range)}
        GROUP BY 1`,
    ]);
    const convCounts = new Map(convRows.map((r) => [r.day, Number(r.n)]));
    const msgCounts = new Map(msgRows.map((r) => [r.day, Number(r.n)]));

    res.json(
      keys.map((k) => ({
        date: k,
        label: arDayMonthLabel(k),
        conversations: convCounts.get(k) ?? 0,
        messages: msgCounts.get(k) ?? 0,
      }))
    );
  })
);

/**
 * Embudo del ciclo de vida CRM (New → Hot → Payment → Customer) con la
 * conversión entre etapas. Reutiliza `getFunnel` (conteos por etapa) y agrega:
 *  - `pctOfTotal`: qué porcentaje del total de contactos está en la etapa.
 *  - `conversionFromPrev`: conversión respecto de la etapa anterior
 *    (count[i] / count[i-1] * 100). La primera etapa no tiene anterior (null).
 */
router.get(
  '/funnel',
  requireAuth,
  cacheResponse(ANALYTICS_TTL_MS),
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const { counts, total, stages } = await getFunnel(businessId);

    const funnel = stages.map((stage, idx) => {
      const count = counts[stage];
      const prevCount = idx === 0 ? null : counts[stages[idx - 1]];
      const conversionFromPrev =
        prevCount === null
          ? null
          : prevCount > 0
            ? parseFloat(((count / prevCount) * 100).toFixed(1))
            : 0;
      return {
        stage,
        label: STAGE_LABELS[stage],
        count,
        pctOfTotal: total > 0 ? parseFloat(((count / total) * 100).toFixed(1)) : 0,
        conversionFromPrev,
      };
    });

    res.json({ total, stages: funnel });
  })
);

/**
 * Embudo por origen (Click-to-WhatsApp Ads). Agrega las conversaciones del
 * negocio por su `metadata.attribution`: cuántas vinieron de un anuncio, el
 * desglose por origen y el top de anuncios por volumen.
 *
 * Traemos sólo `metadata` de las conversaciones del negocio y agregamos en
 * memoria: es lo más simple y correcto (la metadata es Json libre, sin índice
 * por el JSON path de `attribution`). Scope multi-tenant por `businessId`.
 */
router.get(
  '/attribution',
  requireAuth,
  rangeQuery,
  cacheResponse(ANALYTICS_TTL_MS),
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const range = rangeOf(req, 30); // solo filtra si el cliente pidió un rango

    // Agregado EN LA DB (antes se traía el metadata de TODAS las conversaciones del
    // negocio a memoria). Mismas reglas que la lectura tolerante anterior: la
    // atribución vale solo si metadata y metadata.attribution son objetos y
    // `source` es un string no vacío; los demás campos cuentan solo si son string
    // no vacío (se recortan espacios). Ver attributionBase().
    const [totals, sources, ads] = await Promise.all([
      prisma.$queryRaw<{ total: number; attributed: number }[]>`
        ${attributionBase(businessId, undefined, range)}
        SELECT COUNT(*)::int AS total, COUNT(source)::int AS attributed FROM base`,
      prisma.$queryRaw<{ source: string; n: number }[]>`
        ${attributionBase(businessId, undefined, range)}
        SELECT source, COUNT(*)::int AS n FROM base WHERE source IS NOT NULL
        GROUP BY source ORDER BY n DESC, source ASC`,
      prisma.$queryRaw<{ source_id: string | null; headline: string | null; n: number }[]>`
        ${attributionBase(businessId, undefined, range)}
        SELECT MAX(source_id) AS source_id, MIN(headline) AS headline, COUNT(*)::int AS n
        FROM base
        WHERE source IS NOT NULL AND COALESCE(source_id, 'headline:' || headline) IS NOT NULL
        GROUP BY COALESCE(source_id, 'headline:' || headline)
        ORDER BY n DESC, COALESCE(source_id, 'headline:' || headline) ASC
        LIMIT 10`,
    ]);

    res.json({
      total: Number(totals[0]?.total ?? 0),
      attributed: Number(totals[0]?.attributed ?? 0),
      bySource: sources.map((r) => ({ source: r.source, count: Number(r.n) })),
      byAd: ads.map((r) => ({
        sourceId: r.source_id ?? '',
        ...(r.headline ? { headline: r.headline } : {}),
        count: Number(r.n),
      })),
    });
  })
);

export const analyticsRouter = router;
