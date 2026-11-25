/**
 * Lead scoring de intención de compra: mira la conversación y estima qué tan
 * cerca de comprar/reservar está el cliente, devolviendo una TEMPERATURA
 * (CALIENTE / TIBIO / FRÍO), un PUNTAJE 0–100 y un MOTIVO corto para el agente.
 *
 * Reusa el motor de IA del negocio (`getAIProviderForBusiness`) igual que el
 * chatbot y el copiloto. Es una operación de SOLO LECTURA sobre los mensajes: no
 * crea ni envía nada. El resultado se persiste en `Conversation.metadata`
 * (schema congelado) desde la ruta, con el mismo lock que el resto del inbox.
 *
 * Gap de competencia "lead scoring de intención de compra"
 * (respond.io/Clientify, temperatura estilo ForjaBots) — ver replica/features.csv.
 */
import { prisma } from '../../lib/prisma';
import { getAIProviderForBusiness } from './engine';
import type { TokenUsage } from './provider';
import { recordAiSpend } from './usage';
import { loadSystemPrompt } from './system-prompt';

/** Temperatura de intención de compra del lead. */
export type LeadTemperature = 'CALIENTE' | 'TIBIO' | 'FRIO';

export interface LeadScore {
  /** CALIENTE (listo para comprar), TIBIO (interesado), FRIO (lejos o sólo curiosea). */
  temperature: LeadTemperature;
  /** Intención de compra estimada, 0 a 100 (100 = inminente). */
  score: number;
  /** 1 a 2 oraciones explicando por qué, para que el agente decida el próximo paso. */
  reason: string;
  /** Momento del cálculo (ISO), para mostrar "calculado hace X" y permitir recalcular. */
  at: string;
}

/** Últimos N mensajes que miramos (igual que el historial del chatbot/copiloto). */
const MAX_MESSAGES = 50;
/** Recorte por mensaje para no inflar el prompt con textos enormes. */
const MAX_CHARS_PER_MSG = 1500;

const TEMP_MARK = 'TEMPERATURA:';
const SCORE_MARK = 'PUNTAJE:';
const REASON_MARK = 'MOTIVO:';

/** Etiqueta legible por rol para el transcript (SYSTEM y otros se omiten). */
function roleLabel(role: string): string | null {
  if (role === 'USER') return 'Cliente';
  if (role === 'BOT') return 'Negocio';
  return null;
}

/** Quita acentos para comparar la temperatura sin depender de "FRÍO"/"FRIO". */
function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function normalizeTemp(raw: string): LeadTemperature | null {
  const t = stripAccents(raw).toUpperCase().trim();
  if (t.startsWith('CALIENTE')) return 'CALIENTE';
  if (t.startsWith('TIBIO')) return 'TIBIO';
  if (t.startsWith('FRIO')) return 'FRIO';
  return null;
}

/** Deriva la temperatura del puntaje cuando el modelo no la dio explícita. */
function tempFromScore(score: number): LeadTemperature {
  if (score >= 67) return 'CALIENTE';
  if (score >= 34) return 'TIBIO';
  return 'FRIO';
}

/** Lee el valor que sigue a un marcador hasta el fin de línea (vacío si no está). */
function fieldLine(text: string, mark: string): string {
  const i = text.indexOf(mark);
  if (i === -1) return '';
  const after = text.slice(i + mark.length);
  const nl = after.indexOf('\n');
  return (nl === -1 ? after : after.slice(0, nl)).trim();
}

/**
 * Parsea la salida del modelo a un LeadScore robusto. Si el modelo no respetó el
 * formato, degradamos sin romper: puntaje 0, temperatura derivada y el texto
 * crudo como motivo (la UI muestra igual algo útil). Nunca tira.
 */
export function parseLeadScore(raw: string): Omit<LeadScore, 'at'> {
  const text = (raw ?? '').trim();

  // Puntaje: primer entero del campo PUNTAJE (o del texto si no hay marcador).
  const scoreField = fieldLine(text, SCORE_MARK) || text;
  const scoreMatch = scoreField.match(/-?\d+/);
  let score = scoreMatch ? parseInt(scoreMatch[0], 10) : NaN;
  if (!Number.isFinite(score)) score = 0;
  score = Math.max(0, Math.min(100, score));

  // Temperatura: explícita si está; si no, derivada del puntaje.
  const temperature = normalizeTemp(fieldLine(text, TEMP_MARK)) ?? tempFromScore(score);

  // Motivo: todo lo que sigue a MOTIVO:; si no hay marcador, el texto completo.
  const iReason = text.indexOf(REASON_MARK);
  const reason = iReason !== -1 ? text.slice(iReason + REASON_MARK.length).trim() : text;

  return { temperature, score, reason };
}

/**
 * Calcula el lead score de una conversación del negocio (SOLO lectura + IA).
 * Devuelve `null` si la conversación no existe para ese negocio (multi-tenant).
 * La persistencia en metadata la hace la ruta (con lock), no este servicio.
 */
export async function generateLeadScore(
  businessId: string,
  conversationId: string,
): Promise<LeadScore | null> {
  // Scope por negocio: la conversación tiene que ser de ESTE negocio.
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, businessId },
    select: { id: true, contactName: true },
  });
  if (!conversation) return null;

  // Últimos mensajes en orden cronológico (desc + take + reverse), igual que el
  // historial del chatbot: en charlas largas queremos lo más reciente.
  const recent = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: MAX_MESSAGES,
    select: { role: true, text: true },
  });
  const transcript = recent
    .reverse()
    .map((m) => {
      const label = roleLabel(m.role);
      if (!label) return null;
      const t = m.text.length > MAX_CHARS_PER_MSG ? `${m.text.slice(0, MAX_CHARS_PER_MSG)}…` : m.text;
      return `${label}: ${t}`;
    })
    .filter((l): l is string => l !== null)
    .join('\n');

  // Contexto del negocio (rubro/estilo) para que el modelo entienda qué es "comprar"
  // en este negocio. Reusamos el prompt de sistema custom; la voz de marca no hace
  // falta porque el resultado es interno (no se le habla al cliente).
  const [business, customPrompt] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId }, select: { name: true } }),
    loadSystemPrompt(businessId),
  ]);
  const businessName = business?.name || 'el negocio';

  const systemLines = [
    `Sos el analista comercial de "${businessName}". Evaluás la INTENCIÓN DE COMPRA/RESERVA del cliente en una conversación. Esto es interno para el equipo; el cliente NO te lee.`,
    'Estimá qué tan cerca está el cliente de comprar, reservar o pagar, en base a señales reales: pide precio, pregunta disponibilidad u horarios, da datos de contacto, muestra urgencia, pide link de pago, confirma. Las dudas vagas o "solo miro" son FRÍO.',
    'Escala: PUNTAJE de 0 a 100 (0 = sin interés, 100 = compra inminente). Temperatura: CALIENTE (67-100, listo para cerrar), TIBIO (34-66, interesado pero falta), FRIO (0-33, lejos o solo curiosea).',
    'No inventes: juzgá solo por lo que aparece en la conversación. Si casi no hay mensajes del cliente, es FRIO con puntaje bajo.',
    'FORMATO EXACTO de tu salida (sin markdown y sin texto extra antes o después):',
    `${TEMP_MARK} <CALIENTE|TIBIO|FRIO>\n${SCORE_MARK} <0-100>\n${REASON_MARK} <1 a 2 oraciones explicando la señal principal>`,
  ];
  if (customPrompt.trim()) {
    systemLines.push('Contexto del negocio (para entender qué es una venta acá):\n' + customPrompt.trim());
  }
  const systemPrompt = systemLines.join('\n');

  const clientRef = conversation.contactName ? ` (cliente: ${conversation.contactName})` : '';
  const instruction =
    `Conversación${clientRef}:\n\n${transcript || '(sin mensajes todavía)'}\n\n` +
    'Devolvé ahora la TEMPERATURA, el PUNTAJE y el MOTIVO en el formato indicado.';

  // Pasamos la charla como texto en un único turno de usuario (history vacío)
  // para no depender de la alternancia de roles entre proveedores. No
  // guardamos mensajes: es una herramienta interna del agente. Pero el consumo SÍ
  // se registra en el libro de gasto (recordAiSpend), para que cuente en el tope
  // mensual aunque no haya un mensaje BOT.
  const provider = await getAIProviderForBusiness(businessId);
  let usage: TokenUsage | undefined;
  const raw = await provider.generateResponse(instruction, {
    businessId,
    history: [],
    systemPrompt,
    recordUsage: (u) => { usage = u; },
  });
  if (usage) await recordAiSpend(businessId, usage, 'lead-score');

  return { ...parseLeadScore(raw), at: new Date().toISOString() };
}
