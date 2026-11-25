import crypto from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { processMessage } from '../services/chatbot';
import { getIO } from '../lib/socket';
import { cacheKey } from '../lib/cache';
import { sharedIncr, sharedGet, sharedSet } from '../lib/sharedState';
import * as whatsapp from '../services/whatsapp/client';
import { issueOtp, verifyOtp, publicBookingRequiresOtp } from '../lib/otp';

const router = Router();

// Tope diario de mensajes CON imágenes por negocio (superpoder "Oído y vista").
// Las llamadas de visión a la IA son bastante más caras que un mensaje de texto,
// y el chat público es anónimo. El rate limit global de la API ya frena el abuso
// masivo; esto agrega un límite de costo específico para visión, por negocio y
// por día. Es una caché en memoria (best-effort): si el proceso reinicia, se
// reinicia el contador — suficiente como guarda de costo.
const MAX_VISION_MSGS_PER_DAY = 300;

// Tope diario GENERAL de mensajes del chat público por negocio (texto incluido).
// El chat público es anónimo y cada mensaje que llega al LLM cuesta tokens. El
// rate limit global es POR IP (no frena a muchos usuarios distintos atacando un
// mismo negocio). Este tope es POR NEGOCIO y protege el costo de IA del dueño:
// si se supera, respondemos amablemente SIN llamar al proveedor. Caché en
// compartido entre instancias vía Redis (sharedState); sin Redis cae a memoria.
const MAX_CHAT_MSGS_PER_DAY = 1000;

/**
 * Incrementa y controla el contador diario de mensajes con imágenes del negocio.
 * Devuelve `true` si ya se superó el tope (hay que rechazar). El incremento es
 * atómico en Redis, así que el tope vale para el negocio completo aunque haya
 * varias instancias (antes cada una llevaba su propio contador).
 */
async function overVisionDailyLimit(businessId: string): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const key = cacheKey(businessId, 'vision-msgs', day);
  // TTL de 24h: la clave del día vive lo suficiente y luego se descarta sola.
  return (await sharedIncr(key, 24 * 60 * 60 * 1000)) > MAX_VISION_MSGS_PER_DAY;
}

/**
 * Incrementa y controla el contador diario GENERAL de mensajes del negocio.
 * Devuelve `true` si ya se superó el tope (hay que rechazar antes de llamar al
 * LLM). Mismo mecanismo que el de visión, pero para todo mensaje.
 */
async function overChatDailyLimit(businessId: string): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const key = cacheKey(businessId, 'chat-msgs', day);
  return (await sharedIncr(key, 24 * 60 * 60 * 1000)) > MAX_CHAT_MSGS_PER_DAY;
}

// URL de imagen válida: debe ser http(s). Se usa para el superpoder "Oído y
// vista" (visión) — el widget puede pegar una URL de imagen para preguntar sobre ella.
const httpImageUrl = z
  .string()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), 'La URL de imagen debe empezar con http:// o https://');

const chatSchema = z.object({
  message: z.string().min(1).max(2000),
  botId: z.string(),
  conversationId: z.string().optional(),
  // Token de lectura de esa conversación (también se acepta en el header X-Chat-Token).
  chatToken: z.string().max(128).optional(),
  contactName: z.string().max(100).optional(),
  contactPhone: z.string().max(30).optional(),
  // Una sola URL de imagen o un arreglo (máximo 4). Ambos campos son opcionales.
  imageUrl: httpImageUrl.optional(),
  imageUrls: z.array(httpImageUrl).max(4).optional(),
});

// Validación de la reserva pública (endpoint anónimo). Tipar con zod evita el
// "type confusion": sin esto, un `phone` como objeto ({"contains":""}) se
// pasaba a Prisma como operador de filtro (asociaba la reserva a un cliente
// cualquiera), y un `time` no-string hacía `time.split` → 500.
const bookSchema = z.object({
  serviceId: z.string().min(1).max(100),
  professionalId: z.string().max(100).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Fecha inválida (YYYY-MM-DD)'),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (HH:MM)'),
  name: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(1).max(30),
  email: z.string().email().max(200).optional().or(z.literal('')),
  otp: z.string().max(10).optional(),
});

// ─── Lectura de respuestas (polling del widget) ─────────────────────────
//
// El widget solo hace POST /chat; para que el visitante vea lo que le responde un
// humano desde el inbox, consulta GET /chat/:botId/messages. Es un endpoint
// público de LECTURA, así que la conversationId sola no alcanza: el POST /chat
// devuelve un token de lectura aleatorio al abrir la conversación (solo su hash
// SHA-256 queda en Conversation.metadata.chatTokenHash) y el GET lo exige.

/** Mensajes máximos por respuesta de polling. */
const MAX_POLL_MESSAGES = 50;
/** Rate limit del polling: ventana y topes (el widget consulta cada ~4 s = ~15/min). */
const POLL_WINDOW_MS = 60 * 1000;
const POLL_MAX_PER_IP = 60;
const POLL_MAX_PER_CONVERSATION = 30;

const hashChatToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');

/** Comparación en tiempo constante de dos hashes hex (mismo largo o falso). */
function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Genera y guarda el token de lectura de una conversación recién creada. Solo
 * persiste el hash. Devuelve el token en claro (única vez que existe), o undefined
 * si la conversación ya tenía token o falló (el chat sigue andando sin polling).
 * Serializa con SELECT ... FOR UPDATE, igual que el resto de las escrituras de
 * Conversation.metadata (conversations.ts), para no pisar otros cambios.
 */
async function issueChatToken(
  businessId: string,
  botId: string,
  conversationId: string,
): Promise<string | undefined> {
  try {
    const token = crypto.randomBytes(32).toString('base64url');
    const issued = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "conversations"
        WHERE id = ${conversationId} AND "businessId" = ${businessId} AND "botId" = ${botId}
        FOR UPDATE`;
      if (locked.length === 0) return false;
      const fresh = await tx.conversation.findUnique({ where: { id: conversationId }, select: { metadata: true } });
      const meta =
        fresh?.metadata && typeof fresh.metadata === 'object' && !Array.isArray(fresh.metadata)
          ? { ...(fresh.metadata as Record<string, unknown>) }
          : {};
      if (typeof meta.chatTokenHash === 'string') return false; // ya tiene: no se rota ni se re-emite
      meta.chatTokenHash = hashChatToken(token);
      await tx.conversation.update({
        where: { id: conversationId },
        data: { metadata: meta as Prisma.InputJsonValue },
      });
      return true;
    });
    return issued ? token : undefined;
  } catch (err) {
    console.error('[PublicChat] no se pudo emitir el token de lectura:', err instanceof Error ? err.name : 'error');
    return undefined;
  }
}

const CHAT_TOKEN_RE = /^[A-Za-z0-9_-]{20,128}$/;

const pollQuerySchema = z.object({
  conversationId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  // Solo por compatibilidad: el token viaja preferentemente en el header X-Chat-Token
  // (la query queda en logs de acceso/proxies).
  token: z.string().regex(CHAT_TOKEN_RE).optional(),
  // ISO 8601 o id de un mensaje ya recibido.
  after: z.string().max(64).optional(),
});

/** Token de lectura de la request: header X-Chat-Token (preferido) o, si no, el candidato de query/body. */
function readChatToken(req: { get(name: string): string | undefined }, fallback?: string): string | undefined {
  const header = req.get('x-chat-token');
  const candidate = header || fallback;
  return candidate && CHAT_TOKEN_RE.test(candidate) ? candidate : undefined;
}

/**
 * ¿`token` da acceso a esta conversación? Exige que la conversación sea de ESTE
 * bot y de SU negocio y que el hash del token coincida (tiempo constante). Se
 * compara siempre (con un hash vacío si no hay) para no abrir un canal de tiempo.
 */
async function conversationAccessible(
  bot: { id: string; businessId: string },
  conversationId: string,
  token: string | undefined,
): Promise<boolean> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, botId: bot.id, businessId: bot.businessId },
    select: { metadata: true },
  });
  const meta =
    conversation?.metadata && typeof conversation.metadata === 'object' && !Array.isArray(conversation.metadata)
      ? (conversation.metadata as Record<string, unknown>)
      : {};
  const storedHash = typeof meta.chatTokenHash === 'string' ? meta.chatTokenHash : '';
  const tokenOk = safeEqualHex(hashChatToken(token ?? ''), storedHash || '0'.repeat(64));
  return !!conversation && !!storedHash && !!token && tokenOk;
}

router.get('/bot/demo', asyncHandler(async (_req, res) => {
  const bot = await prisma.bot.findFirst({
    where: { status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      business: { select: { name: true } },
    },
  });

  if (!bot) {
    res.status(404).json({ error: 'No hay bots activos para demostración' });
    return;
  }

  res.json({
    id: bot.id,
    name: bot.name,
    businessName: bot.business.name,
    status: 'ACTIVE',
  });
}));

router.get('/bot/:botId', asyncHandler(async (req, res) => {
  const bot = await prisma.bot.findUnique({
    where: { id: String(req.params.botId) },
    select: {
      id: true,
      name: true,
      channel: true,
      status: true,
      business: { select: { id: true, name: true } },
    },
  });

  if (!bot || bot.status === 'DRAFT') {
    res.status(404).json({ error: 'Bot no encontrado' });
    return;
  }

  res.json({
    id: bot.id,
    name: bot.name,
    businessName: bot.business.name,
    status: bot.status,
  });
}));

router.post('/chat', asyncHandler(async (req, res) => {
  const data = chatSchema.parse(req.body);

  const bot = await prisma.bot.findUnique({
    where: { id: data.botId },
    select: { id: true, status: true, businessId: true },
  });

  if (!bot) {
    res.status(404).json({ error: 'Bot no encontrado' });
    return;
  }

  if (bot.status !== 'ACTIVE') {
    res.json({
      text: 'El bot no está activo en este momento. Por favor, intentá más tarde.',
      intent: 'FAQ',
      actions: [],
      conversationId: data.conversationId || '',
    });
    return;
  }

  // Guarda de costo por negocio: si se superó el tope diario de mensajes,
  // respondemos amablemente SIN llamar al LLM (protege el gasto de IA del dueño
  // ante un chat público anónimo). Se chequea antes de procesar el mensaje.
  if (await overChatDailyLimit(bot.businessId)) {
    res.json({
      text: 'Estamos recibiendo muchas consultas hoy. Por favor, escribinos más tarde o dejanos tu contacto y te respondemos a la brevedad.',
      intent: 'FAQ',
      actions: [],
      conversationId: data.conversationId || '',
    });
    return;
  }

  // Normalizamos las imágenes (URL única o arreglo) a la forma que espera el
  // chatbot. El gate por superpoder "Oído y vista" se hace en processMessage.
  const imageUrls = [
    ...(data.imageUrl ? [data.imageUrl] : []),
    ...(data.imageUrls ?? []),
  ];
  const images = imageUrls.length ? imageUrls.map((url) => ({ url })) : undefined;

  // Guarda de costo: si el mensaje trae imágenes, controlamos el tope diario de
  // visión del negocio antes de reenviar a la IA. Al superarlo, respondemos de
  // forma amable sin llamar al proveedor (evita el gasto).
  if (images && (await overVisionDailyLimit(bot.businessId))) {
    res.json({
      text: 'Recibimos muchas imágenes hoy. Escribinos tu consulta por texto y con gusto te ayudamos.',
      intent: 'FAQ',
      actions: [],
      conversationId: data.conversationId || '',
    });
    return;
  }

  // Continuar una conversación existente exige su token de lectura: sin él (o con
  // el de otra conversación/otro bot) el id se IGNORA y se abre una conversación
  // nueva, sin revelar nada. Chats viejos (anteriores al token) abren uno nuevo.
  const acceptedConversationId =
    data.conversationId &&
    (await conversationAccessible(bot, data.conversationId, readChatToken(req, data.chatToken)))
      ? data.conversationId
      : undefined;

  const response = await processMessage(bot.businessId, data.message, 'WEB', {
    conversationId: acceptedConversationId,
    botId: data.botId,
    contactName: data.contactName,
    contactPhone: data.contactPhone,
    ...(images ? { images } : {}),
  });

  // Conversación NUEVA (el cliente no mandó id o el server abrió otra): le damos el
  // token de lectura. Si el cliente mandó el id de una existente NO se emite (si no,
  // cualquiera que conozca un id podría obtener acceso de lectura).
  const isNewConversation = !!response.conversationId && response.conversationId !== acceptedConversationId;
  const chatToken = isNewConversation
    ? await issueChatToken(bot.businessId, bot.id, response.conversationId)
    : undefined;

  res.json(chatToken ? { ...response, chatToken } : response);
}));

// Respuestas nuevas de la conversación (humanas y del bot) para el polling del
// widget. Todos los fallos de acceso devuelven el MISMO 404 genérico: no se puede
// distinguir "no existe" de "token inválido" de "es de otro bot" (sin enumeración).
const NOT_FOUND = { error: 'No encontrado' };

router.get('/chat/:botId/messages', asyncHandler(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  const query = pollQuerySchema.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: 'Parámetros inválidos' });
    return;
  }
  const { conversationId, after } = query.data;
  const token = readChatToken(req, query.data.token);

  // Rate limit por IP antes de tocar la base (frena la fuerza bruta de tokens/ids).
  const tooMany = () => {
    res.setHeader('Retry-After', String(Math.ceil(POLL_WINDOW_MS / 1000)));
    res.status(429).json({ error: 'Demasiadas consultas. Probá en un momento.' });
  };
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if ((await sharedIncr(`chat-poll:ip:${ip}`, POLL_WINDOW_MS)) > POLL_MAX_PER_IP) return tooMany();

  const bot = await prisma.bot.findUnique({
    where: { id: String(req.params.botId) },
    select: { id: true, status: true, businessId: true },
  });
  if (!bot || bot.status !== 'ACTIVE') {
    res.status(404).json(NOT_FOUND);
    return;
  }

  // La conversación tiene que ser de ESTE bot y de SU negocio, con el token correcto.
  if (!(await conversationAccessible(bot, conversationId, token))) {
    res.status(404).json(NOT_FOUND);
    return;
  }

  // Rate limit por conversación: recién con el token válido, así quien solo conoce
  // un id no puede agotarle el cupo al visitante real.
  if ((await sharedIncr(`chat-poll:conv:${conversationId}`, POLL_WINDOW_MS)) > POLL_MAX_PER_CONVERSATION) {
    return tooMany();
  }

  // Cursor: ISO 8601 (createdAt) o id de mensaje (desempata por id).
  let cursor: Prisma.MessageWhereInput = {};
  if (after) {
    if (/^\d{4}-\d{2}-\d{2}T/.test(after) && !Number.isNaN(Date.parse(after))) {
      cursor = { createdAt: { gt: new Date(after) } };
    } else {
      const ref = await prisma.message.findFirst({
        where: { id: after, conversationId },
        select: { createdAt: true },
      });
      if (!ref) {
        res.status(400).json({ error: 'Parámetros inválidos' });
        return;
      }
      cursor = { OR: [{ createdAt: { gt: ref.createdAt } }, { createdAt: ref.createdAt, id: { gt: after } }] };
    }
  }

  const rows = await prisma.message.findMany({
    where: { conversationId, role: 'BOT', ...cursor },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: MAX_POLL_MESSAGES,
    select: { id: true, role: true, text: true, createdAt: true, metadata: true },
  });

  // Solo campos públicos: la metadata interna (userId, deliveryError, usage...) nunca sale.
  const messages = rows.map((m) => {
    const md = m.metadata && typeof m.metadata === 'object' && !Array.isArray(m.metadata)
      ? (m.metadata as Record<string, unknown>)
      : {};
    return {
      id: m.id,
      role: m.role,
      text: m.text,
      createdAt: m.createdAt.toISOString(),
      fromHuman: md.sender === 'human',
    };
  });

  res.json({ messages, hasMore: rows.length === MAX_POLL_MESSAGES });
}));

// ─── Public Booking Endpoints ───────────────────────────────────────

router.get('/book/:slug', asyncHandler(async (req, res) => {
  const business = await prisma.business.findUnique({
    where: { slug: String(req.params.slug) },
    select: {
      id: true,
      name: true,
      slug: true,
      phone: true,
      address: true,
    },
  });

  if (!business) {
    res.status(404).json({ error: 'Negocio no encontrado' });
    return;
  }

  const services = await prisma.service.findMany({
    where: { businessId: business.id, isActive: true },
    select: { id: true, name: true, description: true, price: true, duration: true, category: true },
    orderBy: { name: 'asc' },
  });

  const schedules = await prisma.schedule.findMany({
    where: { businessId: business.id, isActive: true },
    select: { dayOfWeek: true, startTime: true, endTime: true, professionalId: true },
    orderBy: { dayOfWeek: 'asc' },
  });

  const professionals = await prisma.professional.findMany({
    where: { businessId: business.id, isAvailable: true },
    select: { id: true, specialties: true, user: { select: { name: true } } },
    orderBy: { user: { name: 'asc' } },
  });

  const profList = professionals.map((p) => ({
    id: p.id,
    name: p.user.name,
    specialties: p.specialties,
  }));

  res.json({
    business,
    services,
    schedules,
    professionals: profList,
    // El widget muestra el paso de verificación por SMS/WhatsApp cuando aplica.
    requiresPhoneVerification: publicBookingRequiresOtp(whatsapp.isConfigured()),
  });
}));

router.get('/book/:slug/slots', asyncHandler(async (req, res) => {
  const { date, serviceId, professionalId } = req.query;
  if (!date || !serviceId) {
    res.status(400).json({ error: 'date and serviceId are required' });
    return;
  }

  const business = await prisma.business.findUnique({
    where: { slug: String(req.params.slug) },
    select: { id: true },
  });

  if (!business) {
    res.status(404).json({ error: 'Negocio no encontrado' });
    return;
  }

  const service = await prisma.service.findFirst({
    where: { id: serviceId as string, businessId: business.id },
    select: { duration: true },
  });

  if (!service) {
    res.status(404).json({ error: 'Servicio no encontrado' });
    return;
  }

  const dateObj = new Date(date as string);
  const dayOfWeek = dateObj.getDay();

  const schedWhere: Prisma.ScheduleWhereInput = { businessId: business.id, dayOfWeek, isActive: true };
  if (professionalId) schedWhere.professionalId = professionalId as string;

  const schedules = await prisma.schedule.findMany({
    where: schedWhere,
    select: { startTime: true, endTime: true },
  });

  if (schedules.length === 0) {
    res.json({ slots: [] });
    return;
  }

  const bookingWhere: Prisma.BookingWhereInput = {
    businessId: business.id,
    date: dateObj,
    status: { notIn: ['CANCELLED'] },
  };
  if (professionalId) bookingWhere.professionalId = professionalId as string;

  const existingBookings = await prisma.booking.findMany({
    where: bookingWhere,
    select: { startTime: true, endTime: true },
  });

  const bookedRanges = existingBookings.map((b) => ({
    start: b.startTime,
    end: b.endTime,
  }));

  const slots: string[] = [];
  for (const sched of schedules) {
    const [startH, startM] = sched.startTime.split(':').map(Number);
    const [endH, endM] = sched.endTime.split(':').map(Number);
    const startMin = startH * 60 + startM;
    const endMin = endH * 60 + endM;

    for (let t = startMin; t + service.duration <= endMin; t += 30) {
      const slotStart = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
      const slotEndMin = t + service.duration;
      const slotEnd = `${String(Math.floor(slotEndMin / 60)).padStart(2, '0')}:${String(slotEndMin % 60).padStart(2, '0')}`;

      const isBooked = bookedRanges.some((b) => {
        return slotStart < b.end && slotEnd > b.start;
      });

      if (!isBooked) {
        slots.push(slotStart);
      }
    }
  }

  res.json({ slots });
}));

// Tope de OTP por teléfono/día y cooldown entre envíos (anti SMS-bombing/costo).
const MAX_OTP_PER_DAY = 5;
const OTP_COOLDOWN_MS = 60 * 1000;

router.post('/book/:slug/request-otp', asyncHandler(async (req, res) => {
  const phone = String(req.body?.phone || '').trim();
  if (!phone) {
    res.status(400).json({ error: 'Falta el teléfono' });
    return;
  }

  const business = await prisma.business.findUnique({
    where: { slug: String(req.params.slug) },
    select: { id: true, whatsappNumber: true },
  });
  if (!business) {
    res.status(404).json({ error: 'Negocio no encontrado' });
    return;
  }

  if (!whatsapp.isConfigured()) {
    res.status(400).json({ error: 'La verificación por WhatsApp no está disponible.' });
    return;
  }

  // Rate limit: cooldown entre envíos + tope diario por teléfono/negocio.
  const day = new Date().toISOString().slice(0, 10);
  const cooldownKey = cacheKey(business.id, 'otp-cooldown', phone);
  if (await sharedGet<number>(cooldownKey)) {
    res.status(429).json({ error: 'Esperá un momento antes de pedir otro código.' });
    return;
  }
  const countKey = cacheKey(business.id, 'otp-count', day, phone);
  const sent = (await sharedGet<number>(countKey)) ?? 0;
  if (sent >= MAX_OTP_PER_DAY) {
    res.status(429).json({ error: 'Demasiados intentos hoy. Probá más tarde.' });
    return;
  }

  const code = await issueOtp(business.id, phone);
  try {
    await whatsapp.sendMessage(
      phone,
      `Tu código de verificación es ${code}. Vence en 10 minutos.`,
      business.whatsappNumber || undefined,
    );
  } catch {
    res.status(502).json({ error: 'No se pudo enviar el código. Intentá de nuevo.' });
    return;
  }

  await sharedSet(cooldownKey, 1, OTP_COOLDOWN_MS);
  await sharedIncr(countKey, 24 * 60 * 60 * 1000);
  res.json({ sent: true });
}));

router.post('/book/:slug', asyncHandler(async (req, res) => {
    const parsed = bookSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Datos de reserva inválidos',
        details: parsed.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })),
      });
      return;
    }
    const { serviceId, professionalId: reqProfId, date, time, name, phone, email, otp } = parsed.data;

    const business = await prisma.business.findUnique({
      where: { slug: String(req.params.slug) },
      select: { id: true },
    });

    if (!business) {
      res.status(404).json({ error: 'Negocio no encontrado' });
      return;
    }

    // Verificación de teléfono (opt-in): si está activa, exigimos un OTP válido
    // antes de crear/asociar el cliente y la reserva. Evita que alguien reserve
    // a nombre del teléfono de otra persona.
    if (publicBookingRequiresOtp(whatsapp.isConfigured())) {
      const result = await verifyOtp(business.id, String(phone).trim(), String(otp || ''));
      if (result !== 'ok') {
        const msg =
          result === 'expired' ? 'El código venció. Pedí uno nuevo.'
          : result === 'too_many_attempts' ? 'Demasiados intentos. Pedí un código nuevo.'
          : result === 'not_found' ? 'Primero verificá tu teléfono.'
          : 'Código de verificación inválido.';
        res.status(401).json({ error: msg, code: 'PHONE_VERIFICATION_REQUIRED' });
        return;
      }
    }

    const service = await prisma.service.findFirst({
      where: { id: serviceId, businessId: business.id, isActive: true },
    });

    if (!service) {
      res.status(404).json({ error: 'Servicio no encontrado' });
      return;
    }

    let client = await prisma.user.findFirst({
      where: { phone, businessId: business.id, role: 'CLIENT' },
    });

    if (!client) {
      // User.email es requerido (@unique global). Si el cliente no da email,
      // generamos uno sintético scopeado por negocio+teléfono (mismo criterio
      // que Telegram), en vez de null (que fallaba). Un email real que colisione
      // con otro tenant devuelve 409 vía el errorHandler (P2002), no 500.
      const clientEmail = email && email.trim()
        ? email.trim()
        : `pub_${business.id}_${phone}@clients.localb.invalid`;
      client = await prisma.user.create({
        data: {
          name,
          phone,
          email: clientEmail,
          role: 'CLIENT',
          businessId: business.id,
          passwordHash: '',
        },
      });
    }

    const [h, m] = time.split(':').map(Number);
    const endMin = h * 60 + m + service.duration;
    const endTime = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;

    let profId = reqProfId as string | undefined;
    if (!profId) {
      const first = await prisma.professional.findFirst({
        where: { businessId: business.id, isAvailable: true },
        select: { id: true },
      });
      profId = first?.id || '';
    }

    // Validación server-side del turno: /slots es solo consultivo (lo usa el
    // widget), así que acá reconfirmamos que el horario cae dentro de un horario
    // activo y que no se solapa con otra reserva. Evita doble-reserva y turnos
    // fuera de agenda enviados directamente a la API.
    const dayOfWeek = new Date(date).getDay();
    const daySchedules = await prisma.schedule.findMany({
      where: {
        businessId: business.id,
        dayOfWeek,
        isActive: true,
        ...(profId ? { professionalId: profId } : {}),
      },
      select: { startTime: true, endTime: true },
    });
    const withinSchedule = daySchedules.some((s) => time >= s.startTime && endTime <= s.endTime);
    if (!withinSchedule) {
      res.status(409).json({ error: 'El horario elegido no está disponible.' });
      return;
    }

    // Reserva atómica: tomamos un advisory lock transaccional por
    // (negocio, profesional, día) y re-chequeamos el solape DENTRO de la
    // transacción, con el lock tomado. Serializa las reservas concurrentes del
    // mismo recurso y cierra la ventana TOCTOU sin necesitar un @@unique en el
    // schema (bloqueado). pg_advisory_xact_lock se libera solo al commit/rollback
    // (compatible con el pooler transaccional de Supabase).
    const lockKey = `booking:${business.id}:${profId}:${date}`;
    const booking = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

      const sameDayBookings = await tx.booking.findMany({
        where: {
          businessId: business.id,
          date: new Date(date),
          status: { notIn: ['CANCELLED'] },
          ...(profId ? { professionalId: profId } : {}),
        },
        select: { startTime: true, endTime: true },
      });
      const overlaps = sameDayBookings.some((b) => time < b.endTime && endTime > b.startTime);
      if (overlaps) return null;

      return tx.booking.create({
        data: {
          businessId: business.id,
          clientId: client.id,
          serviceId: service.id,
          professionalId: profId,
          date: new Date(date),
          startTime: time,
          endTime,
          status: 'PENDING',
          source: 'WEB',
          totalPrice: service.price,
        },
        include: {
          service: { select: { name: true, duration: true, price: true } },
        },
      });
    });

    if (!booking) {
      res.status(409).json({ error: 'Ese horario ya fue reservado. Por favor, elegí otro.' });
      return;
    }

    const admin = await prisma.user.findFirst({
      where: { businessId: business.id, role: 'ADMIN' },
      select: { id: true },
    });

    if (admin) {
      await prisma.notification.create({
        data: {
          businessId: business.id,
          userId: admin.id,
          type: 'BOOKING_CREATED',
          channel: 'PUSH',
          title: 'Nueva reserva web',
          body: `${name} reservó ${service.name} para el ${date} a las ${time}`,
        },
      });
    }

    try {
      getIO()?.to(`business:${business.id}`).emit('booking:created', { booking });
    } catch { /* socket not initialized in tests */ }

    res.status(201).json(booking);
}));

export { router as publicChatRouter };
