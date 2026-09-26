import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { processMessage } from '../services/chatbot';
import { getIO } from '../lib/socket';
import { cache, cacheKey } from '../lib/cache';

const router = Router();

// Tope diario de mensajes CON imágenes por negocio (superpoder "Oído y vista").
// Las llamadas de visión a la IA son bastante más caras que un mensaje de texto,
// y el chat público es anónimo. El rate limit global de la API ya frena el abuso
// masivo; esto agrega un límite de costo específico para visión, por negocio y
// por día. Es una caché en memoria (best-effort): si el proceso reinicia, se
// reinicia el contador — suficiente como guarda de costo.
const MAX_VISION_MSGS_PER_DAY = 300;

/**
 * Incrementa y controla el contador diario de mensajes con imágenes del negocio.
 * Devuelve `true` si ya se superó el tope (hay que rechazar). Node es de un solo
 * hilo, así que el get+set no tiene carrera dentro del proceso.
 */
function overVisionDailyLimit(businessId: string): boolean {
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const key = cacheKey(businessId, 'vision-msgs', day);
  const count = cache.get<number>(key) ?? 0;
  if (count >= MAX_VISION_MSGS_PER_DAY) return true;
  // TTL de 24h: la clave del día vive lo suficiente y luego se descarta sola.
  cache.set(key, count + 1, 24 * 60 * 60 * 1000);
  return false;
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
  contactName: z.string().max(100).optional(),
  contactPhone: z.string().max(30).optional(),
  // Una sola URL de imagen o un arreglo (máximo 4). Ambos campos son opcionales.
  imageUrl: httpImageUrl.optional(),
  imageUrls: z.array(httpImageUrl).max(4).optional(),
});

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
  if (images && overVisionDailyLimit(bot.businessId)) {
    res.json({
      text: 'Recibimos muchas imágenes hoy. Escribinos tu consulta por texto y con gusto te ayudamos.',
      intent: 'FAQ',
      actions: [],
      conversationId: data.conversationId || '',
    });
    return;
  }

  const response = await processMessage(bot.businessId, data.message, 'WEB', {
    conversationId: data.conversationId,
    botId: data.botId,
    contactName: data.contactName,
    contactPhone: data.contactPhone,
    ...(images ? { images } : {}),
  });

  res.json(response);
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

  res.json({ business, services, schedules, professionals: profList });
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

router.post('/book/:slug', asyncHandler(async (req, res) => {
  const { serviceId, professionalId: reqProfId, date, time, name, phone, email } = req.body;

    if (!serviceId || !date || !time || !name || !phone) {
      res.status(400).json({ error: 'Faltan campos obligatorios' });
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
      client = await prisma.user.create({
        data: {
          name,
          phone,
          email: email || null,
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
