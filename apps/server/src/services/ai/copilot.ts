/**
 * Copiloto del inbox: asiste al AGENTE HUMANO (no al cliente).
 *
 * Dada una conversación, genera dos cosas para el agente del equipo:
 *   1) un RESUMEN breve de la charla (qué quiere el cliente, estado, pendientes), y
 *   2) una SUGERENCIA de respuesta, en la voz del negocio, lista para editar y enviar.
 *
 * Reusa el motor de IA del negocio (`getAIProviderForBusiness`) y su identidad
 * (prompt de sistema custom + voz de marca), igual que el chatbot. Es una
 * operación de SOLO LECTURA: no crea mensajes, no envía nada al cliente y no
 * toca el schema (congelado). Devuelve texto para que la UI lo muestre.
 *
 * Gap de competencia "copiloto del agente" (respond.io/Clientify) — ver
 * replica/features.csv y la memoria de competencia.
 */
import { prisma } from '../../lib/prisma';
import { getAIProviderForBusiness } from './engine';
import type { TokenUsage } from './provider';
import { recordAiSpend } from './usage';
import { loadSystemPrompt } from './system-prompt';
import { loadBrandVoice, buildBrandVoicePrompt } from '../brand/config';

export interface CopilotResult {
  /** Resumen de la conversación para que el agente se ponga al día rápido. */
  summary: string;
  /** Borrador de respuesta al cliente, en la voz del negocio (el agente lo edita). */
  suggestedReply: string;
}

/** Últimos N mensajes que miramos (igual que el historial del chatbot). */
const MAX_MESSAGES = 50;
/** Recorte por mensaje para no inflar el prompt con textos enormes. */
const MAX_CHARS_PER_MSG = 1500;

const RESUMEN_MARK = 'RESUMEN:';
const SUGERENCIA_MARK = 'SUGERENCIA:';

/** Etiqueta legible por rol para el transcript (SYSTEM y otros se omiten). */
function roleLabel(role: string): string | null {
  if (role === 'USER') return 'Cliente';
  if (role === 'BOT') return 'Negocio';
  return null;
}

/**
 * Parte la salida del modelo en resumen + sugerencia usando los marcadores.
 * Si el modelo no respetó el formato, degradamos sin romper: todo el texto va
 * al resumen y la sugerencia queda vacía (la UI muestra igual lo que haya).
 */
export function parseCopilot(raw: string): CopilotResult {
  const text = (raw ?? '').trim();
  const iR = text.indexOf(RESUMEN_MARK);
  const iS = text.indexOf(SUGERENCIA_MARK);
  if (iR !== -1 && iS !== -1 && iS > iR) {
    return {
      summary: text.slice(iR + RESUMEN_MARK.length, iS).trim(),
      suggestedReply: text.slice(iS + SUGERENCIA_MARK.length).trim(),
    };
  }
  return { summary: text, suggestedReply: '' };
}

/**
 * Genera el copiloto para una conversación del negocio.
 * Devuelve `null` si la conversación no existe para ese negocio (multi-tenant).
 */
export async function generateCopilot(businessId: string, conversationId: string): Promise<CopilotResult | null> {
  // Scope por negocio: la conversación tiene que ser de ESTE negocio.
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, businessId },
    select: { id: true, contactName: true },
  });
  if (!conversation) return null;

  // Últimos mensajes en orden cronológico (desc + take + reverse), igual que
  // `loadHistory` del chatbot: en charlas largas queremos lo más reciente.
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

  // Identidad del negocio para que la SUGERENCIA suene al negocio (no genérica).
  const [business, customPrompt, brandVoice] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId }, select: { name: true } }),
    loadSystemPrompt(businessId),
    loadBrandVoice(businessId),
  ]);
  const businessName = business?.name || 'el negocio';
  const brandPrompt = buildBrandVoicePrompt(brandVoice, true);

  const systemLines = [
    `Sos el copiloto de atención de "${businessName}". Asistís al AGENTE HUMANO del equipo; el cliente NO te lee.`,
    'A partir del historial de la conversación, producí dos cosas:',
    '1) RESUMEN: 2 a 4 oraciones — qué necesita el cliente, en qué punto está la charla y qué queda pendiente.',
    '2) SUGERENCIA: un borrador de respuesta para enviarle al cliente, en la voz del negocio, cálido y profesional. El agente lo va a leer y editar antes de mandarlo.',
    'Reglas: NO inventes datos (precios, horarios, stock, disponibilidad) que no aparezcan en la conversación; si faltan, dejá un hueco claro entre corchetes para que el agente lo complete (ej: "[completar horario]"). Respondé en el mismo idioma del cliente.',
  ];
  if (brandPrompt) systemLines.push(brandPrompt);
  if (customPrompt.trim()) {
    systemLines.push('Contexto y estilo del negocio (seguilo para la sugerencia):\n' + customPrompt.trim());
  }
  systemLines.push(
    'FORMATO EXACTO de tu salida (sin markdown y sin texto extra antes o después):',
    `${RESUMEN_MARK}\n<tu resumen acá>\n\n${SUGERENCIA_MARK}\n<tu respuesta sugerida acá>`,
  );
  const systemPrompt = systemLines.join('\n');

  const clientRef = conversation.contactName ? ` (cliente: ${conversation.contactName})` : '';
  const instruction =
    `Conversación${clientRef}:\n\n${transcript || '(sin mensajes todavía)'}\n\n` +
    'Generá ahora el RESUMEN y la SUGERENCIA en el formato indicado.';

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
  if (usage) await recordAiSpend(businessId, usage, 'copilot');

  return parseCopilot(raw);
}
