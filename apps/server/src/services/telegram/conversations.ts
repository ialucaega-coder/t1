import { prisma } from '../../lib/prisma';
import {
  servicesKeyboard,
  professionalsKeyboard,
  dateKeyboard,
  timeSlotsKeyboard,
  confirmationKeyboard,
} from './keyboards';
import type { Context } from 'grammy';
import { sharedGet, sharedSet, sharedDel } from '../../lib/sharedState';
import { createBooking } from '../bookings/create';
import { HH_MM_REGEX, computeEndTime, minutesToTime, overlaps, timeToMinutes } from '../bookings/time';
import { AppError } from '../../middleware/errorHandler';

// ────────────────────────────────────────────────────────────────
// Estado conversacional para el flujo de reserva por Telegram.
//
// Cada chat tiene un estado temporal (compartido, ver abajo) que guía el
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
  /** Horarios (HH:mm) que se le ofrecieron al cliente: el callback `time:` solo vale si está acá. */
  slots?: string[];
}

// Estado por chat en el almacén compartido (Redis si hay REDIS_URL, memoria si no).
// Antes vivía en un Map del proceso, sin TTL y con clave solo `chatId`:
//  - con varias instancias el callback de un botón podía caer en una que no tenía
//    el estado y el flujo se rompía;
//  - un mismo usuario hablando con los bots de DOS negocios pisaba su `businessId`;
//  - el Map crecía sin límite.
// Ahora la clave incluye el id del bot de Telegram (un bot = un negocio) y el
// estado vence solo a los 30 min de inactividad (cada set renueva el TTL).
const STATE_TTL_MS = 30 * 60 * 1000;

/** Clave del estado: bot (negocio) + chat. `ctx.me` es el propio bot de Telegram. */
function stateKey(ctx: Context): string {
  return `tg-booking:${ctx.me?.id ?? 'bot'}:${ctx.chat!.id}`;
}

export async function getState(ctx: Context): Promise<BookingState | undefined> {
  return sharedGet<BookingState>(stateKey(ctx));
}

export async function setState(ctx: Context, state: BookingState): Promise<void> {
  await sharedSet(stateKey(ctx), state, STATE_TTL_MS);
}

export async function clearState(ctx: Context): Promise<void> {
  await sharedDel(stateKey(ctx));
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

  await setState(ctx, { step: 'select_service', businessId });

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
  const state = await getState(ctx);
  if (!state) return;

  // `serviceId` viene de callback_data (controlable por el cliente): se acota al
  // negocio del chat para que no resuelva un servicio de otro tenant.
  const service = await prisma.service.findFirst({
    where: { id: serviceId, businessId: state.businessId, deletedAt: null },
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
    await setState(ctx, state);

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
      await clearState(ctx);
      return;
    }

    if (allProfs.length === 1) {
      state.professionalId = allProfs[0].id;
      state.professionalName = allProfs[0].user.name;
      state.step = 'select_date';
      await setState(ctx, state);
      await ctx.reply(
        `📅 *${service.name}* con *${allProfs[0].user.name}*\nElegí una fecha:`,
        { reply_markup: dateKeyboard(), parse_mode: 'Markdown' },
      );
      return;
    }

    state.step = 'select_professional';
    await setState(ctx, state);

    const mapped = allProfs.map((p) => ({ id: p.id, name: p.user.name }));
    await ctx.reply('Elegí un profesional:', {
      reply_markup: professionalsKeyboard(mapped),
    });
    return;
  }

  state.step = 'select_professional';
  await setState(ctx, state);

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
  const state = await getState(ctx);
  if (!state) return;

  const prof = await prisma.professional.findFirst({
    where: { id: professionalId, businessId: state.businessId },
    include: { user: { select: { name: true } } },
  });

  if (!prof) {
    await ctx.reply('⚠️ Profesional no encontrado.');
    return;
  }

  state.professionalId = prof.id;
  state.professionalName = prof.user.name;
  state.step = 'select_date';
  await setState(ctx, state);

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
  const state = await getState(ctx);
  if (!state || !state.professionalId || !state.serviceId) return;

  // El `dateStr` viene del callback_data (lo controla quien manda el update): se
  // valida el formato y que sea una fecha real antes de usarlo.
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? new Date(dateStr) : null;
  if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== dateStr) {
    await ctx.reply('⚠️ Esa fecha no es válida. Elegí una del listado:', { reply_markup: dateKeyboard() });
    return;
  }
  state.date = dateStr;

  // La fecha es un día de calendario (sin hora): se interpreta en UTC, igual que al
  // guardar la reserva (`createBooking`), para que el día de la semana, la
  // disponibilidad y el alta hablen del MISMO día sin depender de la zona del server.
  const selectedDate = parsedDate;
  const dayOfWeek = selectedDate.getUTCDay(); // 0=Dom, 1=Lun, ...

  // Obtener horarios del profesional para ese día
  const schedules = await prisma.schedule.findMany({
    where: {
      businessId: state.businessId,
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
  const service = await prisma.service.findFirst({ where: { id: state.serviceId, businessId: state.businessId, deletedAt: null } });
  if (!service) return;

  // Obtener reservas existentes para ese día y profesional
  // Mismo criterio que el alta (`createBooking`): del negocio y todo lo que no esté
  // CANCELADO ocupa el horario (también COMPLETED / NO_SHOW), así no se ofrece un
  // slot que después el alta rechazaría.
  const existingBookings = await prisma.booking.findMany({
    where: {
      businessId: state.businessId,
      professionalId: state.professionalId,
      date: selectedDate,
      status: { notIn: ['CANCELLED'] },
    },
    select: { startTime: true, endTime: true },
  });

  // Generar slots disponibles
  const slots: string[] = [];
  for (const sched of schedules) {
    const schedStart = timeToMinutes(sched.startTime);
    const schedEnd = timeToMinutes(sched.endTime);
    if (Number.isNaN(schedStart) || Number.isNaN(schedEnd)) continue; // horario mal cargado: se ignora

    for (let mins = schedStart; mins + service.duration <= schedEnd; mins += 30) {
      const slotStart = minutesToTime(mins);
      let slotEnd: string;
      try {
        slotEnd = computeEndTime(slotStart, service.duration); // valida HH:mm y que no cruce la medianoche
      } catch {
        continue;
      }

      // Verificar que no colisione con reservas existentes (comparación en MINUTOS,
      // no de strings: '9:00' < '10:00' falla como texto).
      const hasConflict = existingBookings.some((b) => overlaps({ startTime: slotStart, endTime: slotEnd }, b));

      if (!hasConflict && !slots.includes(slotStart)) {
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
  state.slots = slots;
  await setState(ctx, state);

  await ctx.reply('🕐 Elegí un horario:', {
    reply_markup: timeSlotsKeyboard(slots),
  });
}

// ────────────────────────────────────────────────────────────────
// Paso 5 — Hora seleccionada: mostrar resumen y confirmar
// ────────────────────────────────────────────────────────────────

export async function handleTimeSelected(ctx: Context, time: string): Promise<void> {
  const chatId = ctx.chat!.id;
  const state = await getState(ctx);
  if (!state) return;

  // `time` viene del callback_data (lo controla quien manda el update): tiene que
  // ser HH:mm válido Y uno de los horarios que se le ofrecieron a este chat.
  if (!HH_MM_REGEX.test(time) || !state.slots?.includes(time)) {
    await ctx.reply('⚠️ Ese horario no está disponible. Elegí uno del listado o empezá de nuevo con /reservar');
    return;
  }

  state.startTime = time;
  state.step = 'confirm';
  await setState(ctx, state);

  const service = await prisma.service.findFirst({ where: { id: state.serviceId, businessId: state.businessId, deletedAt: null } });

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
  const state = await getState(ctx);
  if (!state) return;

  if (!confirmed) {
    await clearState(ctx);
    await ctx.reply('❌ Reserva cancelada. Podés empezar de nuevo con /reservar');
    return;
  }

  if (!state.serviceId || !state.professionalId || !state.date || !state.startTime) {
    await ctx.reply('⚠️ Faltan datos. Empezá de nuevo con /reservar');
    await clearState(ctx);
    return;
  }

  try {
    // Buscar o crear usuario-cliente para este chat de Telegram
    const telegramUser = ctx.from;
    const clientName = telegramUser
      ? [telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(' ')
      : 'Cliente Telegram';

    // Buscar cliente existente por email generado para Telegram. El email
    // incluye el businessId: sin él, el mismo chatId de Telegram usado en dos
    // negocios compartía el MISMO User (clientId de otro tenant), mezclando datos
    // entre negocios. Scopeado por negocio, cada uno tiene su propio cliente.
    const telegramEmail = `telegram_${state.businessId}_${chatId}@localb.bot`;
    let client = await prisma.user.findFirst({ where: { email: telegramEmail, businessId: state.businessId } });

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

    // El alta usa el MISMO motor que el panel y las automatizaciones
    // (`services/bookings/create`): valida servicio / cliente / profesional del
    // negocio, calcula el fin con `computeEndTime` (HH:mm estricto, sin cruzar la
    // medianoche), y crea con advisory lock por (negocio, profesional, día) +
    // re-chequeo de solape en MINUTOS dentro de la transacción. `actingUserId`
    // vacío fuerza validar que el cliente sea del negocio.
    let booking;
    try {
      booking = await createBooking(
        state.businessId,
        {
          serviceId: state.serviceId,
          date: state.date,
          startTime: state.startTime,
          professionalId: state.professionalId,
          clientId: client.id,
          source: 'TELEGRAM',
          notes: `Reserva desde Telegram — @${telegramUser?.username || chatId}`,
        },
        '',
      );
    } catch (err) {
      if (err instanceof AppError && err.statusCode === 409) {
        await clearState(ctx);
        await ctx.reply('⚠️ Ese horario se acaba de ocupar. Empezá de nuevo con /reservar y elegí otro.');
        return;
      }
      if (err instanceof AppError && (err.statusCode === 400 || err.statusCode === 404)) {
        await clearState(ctx);
        await ctx.reply('⚠️ No se pudo crear la reserva con esos datos. Empezá de nuevo con /reservar');
        return;
      }
      throw err;
    }

    await clearState(ctx);

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
    await clearState(ctx);
    await ctx.reply('⚠️ Hubo un error al crear la reserva. Intentá de nuevo más tarde.');
  }
}
