import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { processMessage } from '../services/chatbot';
import { getIO } from '../lib/socket';

const router = Router();

const chatSchema = z.object({
  message: z.string().min(1).max(2000),
  botId: z.string(),
  conversationId: z.string().optional(),
  contactName: z.string().max(100).optional(),
  contactPhone: z.string().max(30).optional(),
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

  const response = await processMessage(bot.businessId, data.message, 'WEB', {
    conversationId: data.conversationId,
    botId: data.botId,
    contactName: data.contactName,
    contactPhone: data.contactPhone,
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

  const schedWhere: any = { businessId: business.id, dayOfWeek, isActive: true };
  if (professionalId) schedWhere.professionalId = professionalId as string;

  const schedules = await prisma.schedule.findMany({
    where: schedWhere,
    select: { startTime: true, endTime: true },
  });

  if (schedules.length === 0) {
    res.json({ slots: [] });
    return;
  }

  const bookingWhere: any = {
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

    const booking = await prisma.booking.create({
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
      getIO().to(`business:${business.id}`).emit('booking:created', { booking });
    } catch { /* socket not initialized in tests */ }

    res.status(201).json(booking);
}));

export { router as publicChatRouter };
