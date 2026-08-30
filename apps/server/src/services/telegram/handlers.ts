import type { Bot, Context } from 'grammy';
import { prisma } from '../../lib/prisma';
import { mainMenuKeyboard, bookingsKeyboard } from './keyboards';
import {
  startBookingFlow,
  handleServiceSelected,
  handleProfessionalSelected,
  handleDateSelected,
  handleTimeSelected,
  handleConfirmation,
  clearState,
} from './conversations';

// ────────────────────────────────────────────────────────────────
// Registro de handlers (comandos y callbacks) para el bot.
//
// Cada comando se registra sobre la instancia de Bot<Context> de
// grammY. Los callback_query manejan las interacciones con los
// teclados inline.
// ────────────────────────────────────────────────────────────────

export function registerHandlers(bot: Bot<Context>, businessId: string): void {
  // ── /start ──────────────────────────────────────────────────
  bot.command('start', async (ctx) => {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { name: true },
    });

    const name = business?.name || 'nuestro negocio';
    await ctx.reply(
      [
        `👋 ¡Hola! Bienvenido/a a *${name}*`,
        '',
        'Soy tu asistente de reservas. ¿Qué te gustaría hacer?',
      ].join('\n'),
      { reply_markup: mainMenuKeyboard(), parse_mode: 'Markdown' },
    );
  });

  // ── /reservar ───────────────────────────────────────────────
  bot.command('reservar', async (ctx) => {
    await startBookingFlow(ctx, businessId);
  });

  // ── /servicios ──────────────────────────────────────────────
  bot.command('servicios', async (ctx) => {
    const services = await prisma.service.findMany({
      where: { businessId, isActive: true, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
      include: { category: { select: { name: true } } },
    });

    if (services.length === 0) {
      await ctx.reply('😕 No hay servicios disponibles en este momento.');
      return;
    }

    const lines = services.map((s) => {
      const cat = s.category?.name ? ` (${s.category.name})` : '';
      return `• *${s.name}*${cat}\n  ⏱ ${s.duration} min — 💰 $${Number(s.price)}`;
    });

    await ctx.reply(
      ['📋 *Servicios disponibles:*', '', ...lines].join('\n'),
      { parse_mode: 'Markdown' },
    );
  });

  // ── /horarios ───────────────────────────────────────────────
  bot.command('horarios', async (ctx) => {
    const professionals = await prisma.professional.findMany({
      where: { businessId, isAvailable: true },
      include: {
        user: { select: { name: true } },
        schedules: { where: { isActive: true }, orderBy: { dayOfWeek: 'asc' } },
      },
    });

    if (professionals.length === 0) {
      await ctx.reply('😕 No hay horarios configurados.');
      return;
    }

    const dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

    const sections = professionals.map((p) => {
      const header = `👤 *${p.user.name}*`;
      if (p.schedules.length === 0) return `${header}\n  Sin horarios`;

      const schedLines = p.schedules.map(
        (s) => `  ${dias[s.dayOfWeek]}: ${s.startTime} — ${s.endTime}`,
      );
      return [header, ...schedLines].join('\n');
    });

    await ctx.reply(
      ['🕐 *Horarios de atención:*', '', ...sections].join('\n\n'),
      { parse_mode: 'Markdown' },
    );
  });

  // ── /cancelar ───────────────────────────────────────────────
  bot.command('cancelar', async (ctx) => {
    const chatId = ctx.chat.id;
    const telegramEmail = `telegram_${chatId}@localb.bot`;

    const client = await prisma.user.findUnique({ where: { email: telegramEmail } });
    if (!client) {
      await ctx.reply('No tenés reservas registradas.');
      return;
    }

    const bookings = await prisma.booking.findMany({
      where: {
        clientId: client.id,
        status: { in: ['PENDING', 'CONFIRMED'] },
        date: { gte: new Date() },
      },
      include: { service: { select: { name: true } } },
      orderBy: { date: 'asc' },
    });

    if (bookings.length === 0) {
      await ctx.reply('No tenés reservas pendientes para cancelar.');
      return;
    }

    const mapped = bookings.map((b) => ({
      id: b.id,
      serviceName: b.service.name,
      date: b.date.toISOString().split('T')[0],
      startTime: b.startTime,
    }));

    await ctx.reply('¿Qué reserva querés cancelar?', {
      reply_markup: bookingsKeyboard(mapped),
    });
  });

  // ── /ayuda ──────────────────────────────────────────────────
  bot.command('ayuda', async (ctx) => {
    await ctx.reply(
      [
        '❓ *Comandos disponibles:*',
        '',
        '/start — Menú principal',
        '/reservar — Reservar un turno',
        '/servicios — Ver servicios y precios',
        '/horarios — Ver horarios de atención',
        '/cancelar — Cancelar una reserva',
        '/ayuda — Este mensaje',
      ].join('\n'),
      { parse_mode: 'Markdown' },
    );
  });

  // ── Callbacks de teclados inline ────────────────────────────

  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    await ctx.answerCallbackQuery();

    // Acciones del menú principal
    if (data === 'action:reservar') {
      await startBookingFlow(ctx, businessId);
      return;
    }

    if (data === 'action:servicios') {
      // Reutilizar lógica del comando
      await ctx.api.sendMessage(ctx.chat!.id, '/servicios');
      // Ejecutar directamente la lógica
      const services = await prisma.service.findMany({
        where: { businessId, isActive: true, deletedAt: null },
        orderBy: { sortOrder: 'asc' },
        include: { category: { select: { name: true } } },
      });
      if (services.length === 0) {
        await ctx.reply('😕 No hay servicios disponibles.');
        return;
      }
      const lines = services.map((s) => {
        const cat = s.category?.name ? ` (${s.category.name})` : '';
        return `• *${s.name}*${cat}\n  ⏱ ${s.duration} min — 💰 $${Number(s.price)}`;
      });
      await ctx.reply(['📋 *Servicios disponibles:*', '', ...lines].join('\n'), { parse_mode: 'Markdown' });
      return;
    }

    if (data === 'action:horarios') {
      const professionals = await prisma.professional.findMany({
        where: { businessId, isAvailable: true },
        include: {
          user: { select: { name: true } },
          schedules: { where: { isActive: true }, orderBy: { dayOfWeek: 'asc' } },
        },
      });
      if (professionals.length === 0) {
        await ctx.reply('😕 No hay horarios configurados.');
        return;
      }
      const dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
      const sections = professionals.map((p) => {
        const header = `👤 *${p.user.name}*`;
        if (p.schedules.length === 0) return `${header}\n  Sin horarios`;
        const schedLines = p.schedules.map((s) => `  ${dias[s.dayOfWeek]}: ${s.startTime} — ${s.endTime}`);
        return [header, ...schedLines].join('\n');
      });
      await ctx.reply(['🕐 *Horarios de atención:*', '', ...sections].join('\n\n'), { parse_mode: 'Markdown' });
      return;
    }

    if (data === 'action:cancelar') {
      const chatId = ctx.chat!.id;
      const telegramEmail = `telegram_${chatId}@localb.bot`;
      const client = await prisma.user.findUnique({ where: { email: telegramEmail } });
      if (!client) {
        await ctx.reply('No tenés reservas registradas.');
        return;
      }
      const bookings = await prisma.booking.findMany({
        where: { clientId: client.id, status: { in: ['PENDING', 'CONFIRMED'] }, date: { gte: new Date() } },
        include: { service: { select: { name: true } } },
        orderBy: { date: 'asc' },
      });
      if (bookings.length === 0) {
        await ctx.reply('No tenés reservas pendientes para cancelar.');
        return;
      }
      const mapped = bookings.map((b) => ({
        id: b.id,
        serviceName: b.service.name,
        date: b.date.toISOString().split('T')[0],
        startTime: b.startTime,
      }));
      await ctx.reply('¿Qué reserva querés cancelar?', { reply_markup: bookingsKeyboard(mapped) });
      return;
    }

    if (data === 'action:ayuda') {
      await ctx.reply(
        [
          '❓ *Comandos disponibles:*',
          '',
          '/start — Menú principal',
          '/reservar — Reservar un turno',
          '/servicios — Ver servicios y precios',
          '/horarios — Ver horarios de atención',
          '/cancelar — Cancelar una reserva',
          '/ayuda — Este mensaje',
        ].join('\n'),
        { parse_mode: 'Markdown' },
      );
      return;
    }

    if (data === 'action:menu') {
      clearState(ctx.chat!.id);
      const business = await prisma.business.findUnique({
        where: { id: businessId },
        select: { name: true },
      });
      await ctx.reply(`¿Qué te gustaría hacer en *${business?.name || 'nuestro negocio'}*?`, {
        reply_markup: mainMenuKeyboard(),
        parse_mode: 'Markdown',
      });
      return;
    }

    // ── Flujo de reserva ────────────────────────────────────

    if (data.startsWith('service:')) {
      await handleServiceSelected(ctx, data.replace('service:', ''));
      return;
    }

    if (data.startsWith('professional:')) {
      await handleProfessionalSelected(ctx, data.replace('professional:', ''));
      return;
    }

    if (data.startsWith('date:')) {
      await handleDateSelected(ctx, data.replace('date:', ''));
      return;
    }

    if (data.startsWith('time:')) {
      await handleTimeSelected(ctx, data.replace('time:', ''));
      return;
    }

    if (data.startsWith('confirm:')) {
      await handleConfirmation(ctx, data === 'confirm:yes');
      return;
    }

    // ── Cancelación de reserva ──────────────────────────────

    if (data.startsWith('cancel:')) {
      const bookingId = data.replace('cancel:', '');
      try {
        await prisma.booking.update({
          where: { id: bookingId },
          data: { status: 'CANCELLED' },
        });
        await ctx.reply('✅ Reserva cancelada exitosamente.');
      } catch {
        await ctx.reply('⚠️ No se pudo cancelar la reserva. Intentá de nuevo.');
      }
      return;
    }
  });

  // ── Mensaje de texto libre (fuera de flujo) ─────────────
  bot.on('message:text', async (ctx) => {
    // Si no hay un flujo activo, sugerir usar el menú
    const text = ctx.message.text;
    if (text && !text.startsWith('/')) {
      await ctx.reply(
        'No entendí tu mensaje. Usá el menú o escribí /ayuda para ver los comandos disponibles.',
        { reply_markup: mainMenuKeyboard() },
      );
    }
  });
}
