import { prisma } from '../../lib/prisma';
import {
  servicesKeyboard,
  professionalsKeyboard,
  dateKeyboard,
  timeSlotsKeyboard,
  confirmationKeyboard,
} from './keyboards';
import type { Context } from 'grammy';

// ────────────────────────────────────────────────────────────────
// Estado conversacional para el flujo de reserva por Telegram.
//
// Cada chat tiene un estado temporal (en memoria) que guía el
// flujo: selección de servicio → profesional → fecha → hora →
// confirmación → grabado en DB.
// ────────────────────────────────────────────────────────────────

export interface BookingState {
  step: 'idle' | 'select_service' | 'select_professional' | 'select_date' | 'select_time' | 'confirm';
  businessId: string;
  serviceId?: string;
  serviceName?: string;
  professionalId?: string;
  professionalName?: string;
  date?: string;       // YYYY-MM-DD
  startTime?: string;  // HH:mm
}

// Almacén en memoria de estados por chatId
const states = new Map<number, BookingState>();

export function getState(chatId: number): BookingState | undefined {
  return states.get(chatId);
}

export function setState(chatId: number, state: BookingState): void {
  states.set(chatId, state);
}

export function clearState(chatId: number): void {
  states.delete(chatId);
}

// ────────────────────────────────────────────────────────────────
// Paso 1 — Iniciar flujo: mostrar servicios activos
// ────────────────────────────────────────────────────────────────

export async function startBookingFlow(ctx: Context, businessId: string): Promise<void> {
  const services = await prisma.service.findMany({
    where: { businessId, isActive: true, deletedAt: null },
    orderBy: { sortOrder: 'asc' },
  });

  if (services.length === 0) {
    await ctx.reply('😕 No hay servicios disponibles en este momento.');
    return;
  }

  setState(ctx.chat!.id, { step: 'select_service', businessId });

  const mapped = services.map((s) => ({
    id: s.id,
    name: s.name,
    price: Number(s.price),
    duration: s.duration,
  }));

  await ctx.reply('Elegí un servicio:', {
    reply_markup: servicesKeyboard(mapped),
  });
}

// ────────────────────────────────────────────────────────────────
// Paso 2 — Servicio seleccionado: mostrar profesionales
// ────────────────────────────────────────────────────────────────

export async function handleServiceSelected(ctx: Context, serviceId: string): Promise<void> {
  const chatId = ctx.chat!.id;
  const state = getState(chatId);
  if (!state) return;

  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    include: {
      professionals: {
        where: { isAvailable: true },
        include: { user: { select: { name: true } } },
      },
    },
  });

  if (!service) {
    await ctx.reply('⚠️ Servicio no encontrado. Intentá de nuevo.');
    return;
  }

  state.serviceId = service.id;
  state.serviceName = service.name;

  // Si hay un solo profesional, saltar al paso de fecha
  if (service.professionals.length === 1) {
    const prof = service.professionals[0];
    state.professionalId = prof.id;
    state.professionalName = prof.user.name;
    state.step = 'select_date';
    setState(chatId, state);

    await ctx.reply(
      `📅 *${service.name}* con *${prof.user.name}*\nElegí una fecha:`,
      { reply_markup: dateKeyboard(), parse_mode: 'Markdown' },
    );
    return;
  }

  if (service.professionals.length === 0) {
    // Buscar cualquier profesional disponible del negocio
    const allProfs = await prisma.professional.findMany({
      where: { businessId: state.businessId, isAvailable: true },
      include: { user: { select: { name: true } } },
    });

    if (allProfs.length === 0) {
      await ctx.reply('😕 No hay profesionales disponibles.');
      clearState(chatId);
      return;
    }

    if (allProfs.length === 1) {
      state.professionalId = allProfs[0].id;
      state.professionalName = allProfs[0].user.name;
      state.step = 'select_date';
      setState(chatId, state);
      await ctx.reply(
        `📅 *${service.name}* con *${allProfs[0].user.name}*\nElegí una fecha:`,
        { reply_markup: dateKeyboard(), parse_mode: 'Markdown' },
      );
      return;
    }

    state.step = 'select_professional';
    setState(chatId, state);

    const mapped = allProfs.map((p) => ({ id: p.id, name: p.user.name }));
    await ctx.reply('Elegí un profesional:', {
      reply_markup: professionalsKeyboard(mapped),
    });
    return;
  }

  state.step = 'select_professional';
  setState(chatId, state);

  const mapped = service.professionals.map((p) => ({ id: p.id, name: p.user.name }));
  await ctx.reply('Elegí un profesional:', {
    reply_markup: professionalsKeyboard(mapped),
  });
}

// ────────────────────────────────────────────────────────────────
// Paso 3 — Profesional seleccionado: mostrar fechas
// ────────────────────────────────────────────────────────────────

export async function handleProfessionalSelected(ctx: Context, professionalId: string): Promise<void> {
  const chatId = ctx.chat!.id;
  const state = getState(chatId);
  if (!state) return;

  const prof = await prisma.professional.findUnique({
    where: { id: professionalId },
    include: { user: { select: { name: true } } },
  });

  if (!prof) {
    await ctx.reply('⚠️ Profesional no encontrado.');
    return;
  }

  state.professionalId = prof.id;
  state.professionalName = prof.user.name;
  state.step = 'select_date';
  setState(chatId, state);

  await ctx.reply(
    `📅 *${state.serviceName}* con *${prof.user.name}*\nElegí una fecha:`,
    { reply_markup: dateKeyboard(), parse_mode: 'Markdown' },
  );
}

// ────────────────────────────────────────────────────────────────
// Paso 4 — Fecha seleccionada: mostrar horarios disponibles
// ────────────────────────────────────────────────────────────────

export async function handleDateSelected(ctx: Context, dateStr: string): Promise<void> {
  const chatId = ctx.chat!.id;
  const state = getState(chatId);
  if (!state || !state.professionalId || !state.serviceId) return;

  state.date = dateStr;

  const selectedDate = new Date(dateStr + 'T00:00:00');
  const dayOfWeek = selectedDate.getDay(); // 0=Dom, 1=Lun, ...

  // Obtener horarios del profesional para ese día
  const schedules = await prisma.schedule.findMany({
    where: {
      professionalId: state.professionalId,
      dayOfWeek,
      isActive: true,
    },
  });

  if (schedules.length === 0) {
    await ctx.reply('😕 No hay horarios disponibles para esa fecha. Probá con otra.');
    await ctx.reply('Elegí una fecha:', { reply_markup: dateKeyboard() });
    return;
  }

  // Obtener servicio para la duración
  const service = await prisma.service.findUnique({ where: { id: state.serviceId } });
  if (!service) return;

  // Obtener reservas existentes para ese día y profesional
  const existingBookings = await prisma.booking.findMany({
    where: {
      professionalId: state.professionalId,
      date: selectedDate,
      status: { in: ['PENDING', 'CONFIRMED'] },
    },
    select: { startTime: true, endTime: true },
  });

  // Generar slots disponibles
  const slots: string[] = [];
  for (const sched of schedules) {
    const [startH, startM] = sched.startTime.split(':').map(Number);
    const [endH, endM] = sched.endTime.split(':').map(Number);
    const schedStart = startH * 60 + startM;
    const schedEnd = endH * 60 + endM;

    for (let mins = schedStart; mins + service.duration <= schedEnd; mins += 30) {
      const slotStart = `${Math.floor(mins / 60).toString().padStart(2, '0')}:${(mins % 60).toString().padStart(2, '0')}`;
      const slotEndMins = mins + service.duration;
      const slotEnd = `${Math.floor(slotEndMins / 60).toString().padStart(2, '0')}:${(slotEndMins % 60).toString().padStart(2, '0')}`;

      // Verificar que no colisione con reservas existentes
      const hasConflict = existingBookings.some((b) => {
        const [bsH, bsM] = b.startTime.split(':').map(Number);
        const [beH, beM] = b.endTime.split(':').map(Number);
        const bStart = bsH * 60 + bsM;
        const bEnd = beH * 60 + beM;
        const sStart = mins;
        const sEnd = slotEndMins;
        return sStart < bEnd && sEnd > bStart;
      });

      if (!hasConflict) {
        slots.push(slotStart);
      }
    }
  }

  if (slots.length === 0) {
    await ctx.reply('😕 No hay horarios libres para esa fecha. Probá con otra.');
    await ctx.reply('Elegí una fecha:', { reply_markup: dateKeyboard() });
    return;
  }

  state.step = 'select_time';
  setState(chatId, state);

  await ctx.reply('🕐 Elegí un horario:', {
    reply_markup: timeSlotsKeyboard(slots),
  });
}

// ────────────────────────────────────────────────────────────────
// Paso 5 — Hora seleccionada: mostrar resumen y confirmar
// ────────────────────────────────────────────────────────────────

export async function handleTimeSelected(ctx: Context, time: string): Promise<void> {
  const chatId = ctx.chat!.id;
  const state = getState(chatId);
  if (!state) return;

  state.startTime = time;
  state.step = 'confirm';
  setState(chatId, state);

  const service = await prisma.service.findUnique({ where: { id: state.serviceId } });

  const summary = [
    '📋 *Resumen de tu reserva:*',
    '',
    `🔹 Servicio: *${state.serviceName}*`,
    `👤 Profesional: *${state.professionalName}*`,
    `📅 Fecha: *${state.date}*`,
    `🕐 Hora: *${time}*`,
    service ? `💰 Precio: *$${Number(service.price)}*` : '',
    '',
    '¿Confirmás la reserva?',
  ].filter(Boolean).join('\n');

  await ctx.reply(summary, {
    reply_markup: confirmationKeyboard(),
    parse_mode: 'Markdown',
  });
}

// ────────────────────────────────────────────────────────────────
// Paso 6 — Confirmación: guardar en DB
// ────────────────────────────────────────────────────────────────

export async function handleConfirmation(ctx: Context, confirmed: boolean): Promise<void> {
  const chatId = ctx.chat!.id;
  const state = getState(chatId);
  if (!state) return;

  if (!confirmed) {
    clearState(chatId);
    await ctx.reply('❌ Reserva cancelada. Podés empezar de nuevo con /reservar');
    return;
  }

  if (!state.serviceId || !state.professionalId || !state.date || !state.startTime) {
    await ctx.reply('⚠️ Faltan datos. Empezá de nuevo con /reservar');
    clearState(chatId);
    return;
  }

  try {
    const service = await prisma.service.findUnique({ where: { id: state.serviceId } });
    if (!service) {
      await ctx.reply('⚠️ Servicio no encontrado.');
      clearState(chatId);
      return;
    }

    // Calcular hora de fin
    const [h, m] = state.startTime.split(':').map(Number);
    const endMins = h * 60 + m + service.duration;
    const endTime = `${Math.floor(endMins / 60).toString().padStart(2, '0')}:${(endMins % 60).toString().padStart(2, '0')}`;

    // Buscar o crear usuario-cliente para este chat de Telegram
    const telegramUser = ctx.from;
    const clientName = telegramUser
      ? [telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(' ')
      : 'Cliente Telegram';

    // Buscar cliente existente por email generado para Telegram
    const telegramEmail = `telegram_${chatId}@localb.bot`;
    let client = await prisma.user.findUnique({ where: { email: telegramEmail } });

    if (!client) {
      client = await prisma.user.create({
        data: {
          email: telegramEmail,
          passwordHash: 'telegram-no-password',
          name: clientName,
          role: 'CLIENT',
          businessId: state.businessId,
        },
      });
    }

    // Crear la reserva
    const booking = await prisma.booking.create({
      data: {
        date: new Date(state.date),
        startTime: state.startTime,
        endTime,
        totalPrice: service.price,
        source: 'TELEGRAM',
        notes: `Reserva desde Telegram — @${telegramUser?.username || chatId}`,
        clientId: client.id,
        professionalId: state.professionalId,
        serviceId: state.serviceId,
        businessId: state.businessId,
      },
    });

    clearState(chatId);

    await ctx.reply(
      [
        '✅ *¡Reserva confirmada!*',
        '',
        `📌 Código: \`${booking.id.slice(-8).toUpperCase()}\``,
        `🔹 ${state.serviceName}`,
        `👤 ${state.professionalName}`,
        `📅 ${state.date} a las ${state.startTime}`,
        '',
        'Te esperamos. Si necesitás cancelar, usá /cancelar',
      ].join('\n'),
      { parse_mode: 'Markdown' },
    );
  } catch (error) {
    console.error('Error al crear reserva desde Telegram:', error);
    clearState(chatId);
    await ctx.reply('⚠️ Hubo un error al crear la reserva. Intentá de nuevo más tarde.');
  }
}
