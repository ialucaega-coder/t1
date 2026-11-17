/**
 * Superpoderes de análisis que corren "bajo demanda" (por HTTP), reusando el
 * mismo cerebro de IA que el chatbot:
 *
 *   - "Analista IA": lee una conversación y devuelve un resumen estructurado
 *     (intención, satisfacción, objeciones, próximo paso).
 *   - "Auto-mejora": detecta "huecos de conocimiento" (conversaciones que
 *     terminaron en handoff o donde el bot dijo que no sabía) y sugiere qué
 *     agregar al Prompt/FAQ. Es heurístico (sin IA) para ser barato y estable.
 *
 * Se exponen por routes/catalogFeatures.ts →
 *   GET /api/superpowers/analisis/:conversationId
 *   GET /api/superpowers/gaps
 */
import { prisma } from '../../lib/prisma';
import { getDefaultAIProvider } from '../ai';

/** Resumen estructurado que produce el superpoder "Analista IA". */
export interface ConversationAnalysis {
  intencion: string;
  satisfaccion: string;
  objeciones: string[];
  siguientePaso: string;
  resumen: string;
}

interface TranscriptMessage {
  role: 'USER' | 'BOT' | 'SYSTEM';
  text: string;
}

/** Arma el texto de la conversación (Cliente/Asistente) para pasarlo al modelo. */
function formatTranscript(messages: TranscriptMessage[]): string {
  return messages
    .filter((m) => m.role !== 'SYSTEM')
    .map((m) => `${m.role === 'USER' ? 'Cliente' : 'Asistente'}: ${m.text}`)
    .join('\n');
}

/** Extrae el primer bloque JSON de un texto (tolera fences ```json ... ```). */
function extractJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    console.warn('[analisis] La respuesta del modelo no contenía un bloque JSON; se usa fallback.');
    return null;
  }
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    console.warn('[analisis] No se pudo parsear el JSON del modelo; se usa fallback.');
    return null;
  }
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

/**
 * Superpoder "Analista IA": analiza una conversación con el proveedor de IA por
 * defecto y devuelve un resumen estructurado. Si el modelo no devuelve JSON
 * válido, cae a un resultado best-effort usando el texto crudo como resumen.
 */
export async function analyzeConversation(
  businessId: string,
  messages: TranscriptMessage[],
): Promise<ConversationAnalysis> {
  const transcript = formatTranscript(messages);

  const systemPrompt = [
    'Sos un analista de atención al cliente. Te paso la transcripción de una conversación entre un Cliente y el Asistente virtual de un negocio.',
    'Analizala y devolvé EXCLUSIVAMENTE un objeto JSON válido (sin texto extra, sin markdown) con estas claves:',
    '- "intencion": string. Qué quería lograr el cliente.',
    '- "satisfaccion": string. Nivel estimado de satisfacción: "alta", "media" o "baja", con una breve justificación.',
    '- "objeciones": array de strings. Dudas, quejas u obstáculos que planteó el cliente (vacío si no hubo).',
    '- "siguientePaso": string. La acción concreta recomendada para el negocio.',
    '- "resumen": string. Resumen de 1 o 2 oraciones de la conversación.',
    'Respondé en español.',
  ].join('\n');

  const provider = getDefaultAIProvider();
  const raw = await provider.generateResponse(
    `Transcripción de la conversación:\n\n${transcript}`,
    { businessId, history: [], systemPrompt },
  );

  const parsed = extractJson(raw);
  if (!parsed) {
    return {
      intencion: '',
      satisfaccion: '',
      objeciones: [],
      siguientePaso: '',
      resumen: raw.trim(),
    };
  }

  return {
    intencion: typeof parsed.intencion === 'string' ? parsed.intencion : '',
    satisfaccion: typeof parsed.satisfaccion === 'string' ? parsed.satisfaccion : '',
    objeciones: toStringArray(parsed.objeciones),
    siguientePaso: typeof parsed.siguientePaso === 'string' ? parsed.siguientePaso : '',
    resumen: typeof parsed.resumen === 'string' ? parsed.resumen : raw.trim(),
  };
}

/** Un hueco de conocimiento agrupado por tema. */
export interface KnowledgeGap {
  tema: string;
  ocurrencias: number;
  ejemplos: string[];
  sugerencia: string;
}

/** Resultado del superpoder "Auto-mejora". */
export interface KnowledgeGapsResult {
  analizadas: number;
  conHuecos: number;
  gaps: KnowledgeGap[];
  resumen: string;
}

/** Frases típicas del bot cuando no supo responder. */
const UNKNOWN_PHRASES = [
  'no tengo esa informacion',
  'no tengo esa información',
  'no tengo información',
  'no tengo informacion',
  'no dispongo de',
  'no cuento con esa',
  'no puedo responder',
  'no estoy seguro',
  'no sabria decirte',
  'no sabría decirte',
  'derivar a un humano',
  'te derivo con',
];

/** Buckets de temas: la primera keyword que matchea define el tema. */
const THEME_BUCKETS: { tema: string; keywords: string[] }[] = [
  { tema: 'Precios y costos', keywords: ['precio', 'cuesta', 'cuanto', 'cuánto', 'tarifa', 'valor', 'cobran', 'sale '] },
  { tema: 'Horarios y disponibilidad', keywords: ['horario', 'hora', 'abren', 'cierran', 'disponib', 'agenda', 'cuando', 'cuándo', 'abierto'] },
  { tema: 'Productos y stock', keywords: ['stock', 'producto', 'talle', 'color', 'tienen', 'queda', 'unidad', 'modelo'] },
  { tema: 'Pagos y facturación', keywords: ['pago', 'pagar', 'tarjeta', 'transferencia', 'factura', 'cuota', 'seña', 'sena', 'efectivo'] },
  { tema: 'Ubicación y envíos', keywords: ['donde', 'dónde', 'direccion', 'dirección', 'ubicac', 'envio', 'envío', 'delivery', 'llegar', 'sucursal'] },
  { tema: 'Reservas y turnos', keywords: ['reserva', 'cancelar', 'reprogramar', 'cita', 'turno', 'agendar'] },
];

function classifyTheme(text: string): string {
  const normalized = text.toLowerCase();
  for (const bucket of THEME_BUCKETS) {
    if (bucket.keywords.some((kw) => normalized.includes(kw))) return bucket.tema;
  }
  return 'Otros';
}

function suggestionFor(tema: string): string {
  switch (tema) {
    case 'Precios y costos':
      return 'Agregá al Prompt/FAQ una lista clara de precios y qué incluye cada servicio/producto.';
    case 'Horarios y disponibilidad':
      return 'Cargá los horarios de atención y la política de disponibilidad en el Prompt/FAQ.';
    case 'Productos y stock':
      return 'Mantené el catálogo (variantes, stock) actualizado y sumá esos datos al Prompt/FAQ.';
    case 'Pagos y facturación':
      return 'Documentá los medios de pago aceptados y la política de seña/factura en el Prompt/FAQ.';
    case 'Ubicación y envíos':
      return 'Agregá dirección, zona de cobertura y costos/tiempos de envío al Prompt/FAQ.';
    case 'Reservas y turnos':
      return 'Aclará el proceso de reserva, cancelación y reprogramación en el Prompt/FAQ.';
    default:
      return 'Revisá estas consultas y agregá la información faltante al Prompt/FAQ del bot.';
  }
}

/**
 * Superpoder "Auto-mejora": detecta huecos de conocimiento en las
 * conversaciones recientes (últimos `days` días) — las que terminaron en
 * HANDOFF o donde el bot dijo que no sabía — y los agrupa por tema, con una
 * sugerencia de qué agregar al Prompt/FAQ.
 */
export async function detectKnowledgeGaps(
  businessId: string,
  days = 30,
): Promise<KnowledgeGapsResult> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const conversations = await prisma.conversation.findMany({
    where: { businessId, updatedAt: { gte: since } },
    orderBy: { updatedAt: 'desc' },
    take: 200,
    select: {
      status: true,
      messages: {
        orderBy: { createdAt: 'asc' },
        select: { role: true, text: true },
      },
    },
  });

  const buckets = new Map<string, { ocurrencias: number; ejemplos: string[] }>();
  let conHuecos = 0;

  for (const convo of conversations) {
    const messages = convo.messages;
    // Índice del primer mensaje del bot que "no supo" responder.
    const unknownIdx = messages.findIndex(
      (m) => m.role === 'BOT' && UNKNOWN_PHRASES.some((p) => m.text.toLowerCase().includes(p)),
    );
    const isHandoff = convo.status === 'HANDOFF';
    if (unknownIdx === -1 && !isHandoff) continue;

    // Pregunta representativa: el último mensaje del cliente antes del "no sé"
    // (o el último del cliente si terminó en handoff).
    const limit = unknownIdx === -1 ? messages.length : unknownIdx;
    let question: string | null = null;
    for (let i = limit - 1; i >= 0; i--) {
      if (messages[i].role === 'USER' && messages[i].text.trim()) {
        question = messages[i].text.trim();
        break;
      }
    }
    if (!question) continue;

    conHuecos++;
    const tema = classifyTheme(question);
    const bucket = buckets.get(tema) ?? { ocurrencias: 0, ejemplos: [] };
    bucket.ocurrencias++;
    if (bucket.ejemplos.length < 3) {
      const ejemplo = question.length > 160 ? `${question.slice(0, 157)}...` : question;
      if (!bucket.ejemplos.includes(ejemplo)) bucket.ejemplos.push(ejemplo);
    }
    buckets.set(tema, bucket);
  }

  const gaps: KnowledgeGap[] = Array.from(buckets.entries())
    .map(([tema, data]) => ({
      tema,
      ocurrencias: data.ocurrencias,
      ejemplos: data.ejemplos,
      sugerencia: suggestionFor(tema),
    }))
    .sort((a, b) => b.ocurrencias - a.ocurrencias);

  const resumen =
    conHuecos === 0
      ? `No se detectaron huecos de conocimiento en las ${conversations.length} conversaciones de los últimos ${days} días. El bot viene resolviendo bien.`
      : `Se detectaron ${conHuecos} conversación(es) con huecos de conocimiento en los últimos ${days} días, agrupadas en ${gaps.length} tema(s). Priorizá los temas con más ocurrencias.`;

  return {
    analizadas: conversations.length,
    conHuecos,
    gaps,
    resumen,
  };
}
