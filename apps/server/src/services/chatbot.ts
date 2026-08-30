/**
 * Servicio de chatbot con IA.
 *
 * Este es el punto de entrada principal para procesar mensajes de clientes
 * que llegan por cualquier canal (WhatsApp, Telegram, Web, Voz). Se encarga
 * de: detectar la intención del mensaje, buscar la info necesaria en la
 * base de datos, y generar una respuesta usando el proveedor de IA
 * configurado para el negocio.
 */
import { prisma } from '../lib/prisma';
import { getDefaultAIProvider } from './ai';
import type { ConversationTurn } from './ai';

/** Canales por los que puede llegar un mensaje al bot. */
export type ChatChannel = 'WEB' | 'TELEGRAM' | 'WHATSAPP' | 'VOICE';

/** Intenciones que el bot puede detectar en un mensaje del cliente. */
export type ChatIntent = 'BOOKING' | 'CATALOG' | 'FAQ' | 'HUMAN';

/**
 * Acción sugerida que el frontend/bot puede ejecutar como resultado del
 * mensaje (por ejemplo, mostrar un botón para confirmar una reserva).
 */
export interface ChatAction {
  type: 'createBooking' | 'showCatalog' | 'checkAvailability' | 'escalateToHuman';
  payload?: Record<string, unknown>;
}

/** Respuesta estructurada que devuelve el chatbot. */
export interface ChatbotResponse {
  text: string;
  intent: ChatIntent;
  actions: ChatAction[];
}

/** Input para procesar un mensaje, incluye historial opcional de la charla. */
export interface ProcessMessageOptions {
  history?: ConversationTurn[];
  clientId?: string;
}

/**
 * Detecta la intención del mensaje con reglas simples de palabras clave.
 * Es un primer filtro rápido y barato (sin llamar a la IA) antes de decidir
 * qué información adicional hay que buscar en la base de datos.
 *
 * En una v2 esto podría reemplazarse por una clasificación hecha por el
 * propio modelo de IA, pero las reglas locales evitan una llamada extra
 * a la API para el caso común.
 */
function detectIntent(message: string): ChatIntent {
  const normalized = message.toLowerCase();

  const bookingKeywords = ['turno', 'cita', 'reserva', 'agendar', 'reservar', 'disponibilidad', 'horario libre'];
  const catalogKeywords = ['precio', 'catálogo', 'catalogo', 'servicios', 'productos', 'menú', 'menu', 'cuánto cuesta', 'cuanto cuesta'];
  const humanKeywords = ['humano', 'persona', 'hablar con alguien', 'operador', 'no entiendo', 'ayuda urgente'];

  if (humanKeywords.some((kw) => normalized.includes(kw))) return 'HUMAN';
  if (bookingKeywords.some((kw) => normalized.includes(kw))) return 'BOOKING';
  if (catalogKeywords.some((kw) => normalized.includes(kw))) return 'CATALOG';
  return 'FAQ';
}

/**
 * Arma el prompt de sistema para el negocio: nombre, descripción y
 * reglas básicas de comportamiento del bot. Si el negocio tiene un
 * prompt personalizado guardado (BusinessSettings, futuro), se debería
 * usar ese en vez de este genérico.
 */
async function buildSystemPrompt(businessId: string): Promise<string> {
  const business = await prisma.business.findUnique({ where: { id: businessId } });
  const businessName = business?.name || 'el negocio';

  return [
    `Sos el asistente virtual de "${businessName}". Respondé siempre en español, de forma breve, cálida y profesional.`,
    'Tu trabajo es ayudar a los clientes a: reservar turnos, consultar el catálogo de servicios/productos, responder preguntas frecuentes, o derivarlos a un humano si lo piden.',
    'Si no tenés la información exacta (por ejemplo, disponibilidad real), aclaralo en vez de inventar datos.',
    'No inventes precios ni horarios que no te hayan sido provistos.',
  ].join('\n');
}

/**
 * Busca el catálogo de servicios activos del negocio, usado para armar
 * respuestas de tipo CATALOG o para dar contexto extra a la IA.
 */
async function getActiveCatalog(businessId: string) {
  const [services, products] = await Promise.all([
    prisma.service.findMany({
      where: { businessId, isActive: true },
      select: { id: true, name: true, price: true, duration: true, currency: true },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.product.findMany({
      where: { businessId, isActive: true },
      select: { id: true, name: true, price: true, stock: true },
      orderBy: { sortOrder: 'asc' },
    }),
  ]);
  return { services, products };
}

/** Formatea el catálogo como texto legible para meter en el prompt o la respuesta. */
function formatCatalogText(catalog: Awaited<ReturnType<typeof getActiveCatalog>>): string {
  const lines: string[] = [];
  if (catalog.services.length) {
    lines.push('Servicios disponibles:');
    for (const s of catalog.services) {
      lines.push(`• ${s.name} — ${s.price} ${s.currency} (${s.duration} min)`);
    }
  }
  if (catalog.products.length) {
    lines.push('Productos disponibles:');
    for (const p of catalog.products) {
      lines.push(`• ${p.name} — ${p.price}`);
    }
  }
  return lines.join('\n') || 'Todavía no hay servicios ni productos cargados.';
}

/**
 * Maneja la intención BOOKING: por ahora solo arma la acción sugerida
 * (checkAvailability) para que el frontend/canal siga el flujo de reserva.
 * La creación real de la reserva la hace el endpoint POST /api/bookings.
 */
async function handleBookingIntent(businessId: string): Promise<{ text: string; actions: ChatAction[] }> {
  const professionals = await prisma.professional.count({ where: { businessId, isAvailable: true } });
  if (professionals === 0) {
    return {
      text: 'Por ahora no tenemos profesionales disponibles para agendar. Te derivo con una persona del equipo.',
      actions: [{ type: 'escalateToHuman' }],
    };
  }
  return {
    text: 'Genial, te ayudo a agendar un turno. ¿Qué servicio te interesa y qué día/horario preferís?',
    actions: [{ type: 'checkAvailability' }],
  };
}

/** Maneja la intención CATALOG: devuelve el catálogo formateado + acción para mostrarlo en UI. */
async function handleCatalogIntent(businessId: string): Promise<{ text: string; actions: ChatAction[] }> {
  const catalog = await getActiveCatalog(businessId);
  return {
    text: formatCatalogText(catalog),
    actions: [{ type: 'showCatalog', payload: catalog }],
  };
}

/**
 * Punto de entrada principal del chatbot.
 *
 * @param businessId  Negocio (tenant) al que pertenece la conversación.
 * @param clientMessage  Mensaje de texto enviado por el cliente.
 * @param channel  Canal de origen (WEB, TELEGRAM, WHATSAPP, VOICE).
 * @param options  Historial de conversación previo y datos opcionales del cliente.
 */
export async function processMessage(
  businessId: string,
  clientMessage: string,
  channel: ChatChannel,
  options: ProcessMessageOptions = {}
): Promise<ChatbotResponse> {
  const intent = detectIntent(clientMessage);
  const history = options.history || [];

  // HUMAN: no hace falta llamar a la IA, se corta el flujo automático.
  if (intent === 'HUMAN') {
    return {
      text: 'Entendido, en breve te va a contactar una persona del equipo. Gracias por tu paciencia.',
      intent,
      actions: [{ type: 'escalateToHuman', payload: { channel } }],
    };
  }

  // BOOKING y CATALOG tienen manejo especial con datos reales del negocio.
  if (intent === 'BOOKING') {
    const { text, actions } = await handleBookingIntent(businessId);
    return { text, intent, actions };
  }

  if (intent === 'CATALOG') {
    const { text, actions } = await handleCatalogIntent(businessId);
    return { text, intent, actions };
  }

  // FAQ: se apoya en el proveedor de IA configurado para responder libremente,
  // usando el prompt de sistema del negocio como contexto.
  const systemPrompt = await buildSystemPrompt(businessId);
  let clientName: string | undefined;
  if (options.clientId) {
    const client = await prisma.user.findUnique({ where: { id: options.clientId }, select: { name: true } });
    clientName = client?.name;
  }

  try {
    const provider = getDefaultAIProvider();
    const text = await provider.generateResponse(clientMessage, {
      businessId,
      clientName,
      history,
      systemPrompt,
    });
    return { text, intent, actions: [] };
  } catch (error) {
    // Si no hay proveedor de IA configurado (o falla la llamada), no dejamos
    // al cliente sin respuesta: devolvemos un mensaje de fallback y sugerimos
    // escalar a un humano.
    console.error('Error generando respuesta de IA:', error);
    return {
      text: 'Disculpá, en este momento no puedo responder automáticamente. ¿Querés que te derive con una persona del equipo?',
      intent: 'FAQ',
      actions: [{ type: 'escalateToHuman' }],
    };
  }
}
