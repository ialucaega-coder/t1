/**
 * Ganchos de superpoderes que corren "fuera del prompt": reportes automáticos
 * y recordatorios inteligentes.
 *
 * No hay cron real (queda fuera de alcance): estas funciones arman el TEXTO
 * del resumen / recordatorio leyendo la base de datos, y se exponen por HTTP
 * (ver routes/catalogFeatures.ts → GET /api/superpowers/report y
 * GET /api/superpowers/reminders) para que un scheduler externo, un botón del
 * panel, o un futuro cron las dispare.
 */
import { prisma } from '../../lib/prisma';

/** Rango [desde, hasta) que cubre un día calendario dado (por defecto, hoy). */
function dayRange(reference = new Date()): { start: Date; end: Date; label: string } {
  const start = new Date(reference);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const label = start.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return { start, end, label };
}

export interface DailyReport {
  businessId: string;
  date: string;
  conversations: number;
  newConversations: number;
  messages: number;
  bookings: number;
  handoffs: number;
  /** Resumen listo para mostrar/enviar. */
  text: string;
}

/**
 * Superpoder "Reportes automaticos": arma un resumen diario del negocio
 * (conversaciones, mensajes, reservas y handoffs) en texto plano.
 */
export async function generateDailyReport(businessId: string, reference = new Date()): Promise<DailyReport> {
  const { start, end, label } = dayRange(reference);
  const range = { gte: start, lt: end };

  const [newConversations, activeConversations, messages, bookings, handoffs] = await Promise.all([
    prisma.conversation.count({ where: { businessId, createdAt: range } }),
    prisma.conversation.count({ where: { businessId, updatedAt: range } }),
    prisma.message.count({ where: { createdAt: range, conversation: { businessId } } }),
    prisma.booking.count({ where: { businessId, createdAt: range } }),
    prisma.conversation.count({ where: { businessId, status: 'HANDOFF', updatedAt: range } }),
  ]);

  const text = [
    `Reporte diario — ${label}`,
    `• Conversaciones activas: ${activeConversations} (${newConversations} nuevas)`,
    `• Mensajes intercambiados: ${messages}`,
    `• Reservas generadas: ${bookings}`,
    `• Derivaciones a humano (handoffs): ${handoffs}`,
  ].join('\n');

  return {
    businessId,
    date: label,
    conversations: activeConversations,
    newConversations,
    messages,
    bookings,
    handoffs,
    text,
  };
}

export interface ReminderItem {
  bookingId: string;
  clientName: string;
  date: string;
  time: string;
  service: string;
  /** Texto del recordatorio listo para enviar por el canal del cliente. */
  text: string;
}

/**
 * Superpoder "Recordatorios inteligentes": arma los textos de recordatorio
 * para las reservas confirmadas/pendientes del día siguiente. No envía nada;
 * devuelve los mensajes listos para que un canal o cron los despache.
 */
export async function generateReminders(businessId: string, reference = new Date()): Promise<ReminderItem[]> {
  const target = new Date(reference);
  target.setDate(target.getDate() + 1);
  const { start, end, label } = dayRange(target);

  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { name: true } });
  const businessName = business?.name || 'el negocio';

  const bookings = await prisma.booking.findMany({
    where: {
      businessId,
      date: { gte: start, lt: end },
      status: { in: ['PENDING', 'CONFIRMED'] },
    },
    select: {
      id: true,
      startTime: true,
      client: { select: { name: true } },
      service: { select: { name: true } },
    },
    orderBy: { startTime: 'asc' },
  });

  return bookings.map((b) => {
    const clientName = b.client?.name || 'Hola';
    const service = b.service?.name || 'tu turno';
    const time = b.startTime;
    return {
      bookingId: b.id,
      clientName,
      date: label,
      time,
      service,
      text:
        `${clientName}, te recordamos tu turno en ${businessName} para mañana ${label} a las ${time} ` +
        `(${service}). Respondé SÍ para confirmar o CANCELAR si no podés asistir.`,
    };
  });
}

export interface NoShowRecovery {
  bookingId: string;
  clientName: string;
  service: string;
  /** Mensaje listo para reprogramar el turno perdido. */
  text: string;
}

/**
 * Superpoder "Recupera no-shows": busca los turnos marcados como NO_SHOW en el
 * día dado (por defecto hoy) y arma un mensaje cálido para reprogramarlos.
 * No envía nada; devuelve los textos listos para despachar.
 */
export async function generateNoShowRecovery(businessId: string, reference = new Date()): Promise<NoShowRecovery[]> {
  const { start, end } = dayRange(reference);
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { name: true } });
  const businessName = business?.name || 'el negocio';

  const bookings = await prisma.booking.findMany({
    where: { businessId, status: 'NO_SHOW', updatedAt: { gte: start, lt: end } },
    select: { id: true, client: { select: { name: true } }, service: { select: { name: true } } },
    orderBy: { updatedAt: 'asc' },
  });

  return bookings.map((b) => {
    const clientName = b.client?.name || 'Hola';
    const service = b.service?.name || 'tu turno';
    return {
      bookingId: b.id,
      clientName,
      service,
      text:
        `${clientName}, te esperábamos hoy en ${businessName} para ${service} y no pudiste venir. ` +
        `¿Querés que te reprogramemos? Respondé y coordinamos un nuevo horario que te quede cómodo. 😊`,
    };
  });
}

export interface PostSaleFollowUp {
  bookingId: string;
  clientName: string;
  service: string;
  /** Mensaje de seguimiento listo para enviar: agradece e invita a volver. */
  text: string;
}

/**
 * Superpoder "Seguimiento post-venta": busca los turnos COMPLETED del día
 * anterior y arma un mensaje cálido que agradece la visita e invita a agendar
 * la próxima cita. No envía nada; devuelve los textos listos para despachar.
 */
export async function generatePostSaleFollowUps(
  businessId: string,
  reference = new Date(),
): Promise<PostSaleFollowUp[]> {
  const yesterday = new Date(reference);
  yesterday.setDate(yesterday.getDate() - 1);
  const { start, end } = dayRange(yesterday);

  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { name: true } });
  const businessName = business?.name || 'el negocio';

  const bookings = await prisma.booking.findMany({
    where: { businessId, status: 'COMPLETED', date: { gte: start, lt: end } },
    select: { id: true, client: { select: { name: true } }, service: { select: { name: true } } },
    orderBy: { date: 'asc' },
  });

  return bookings.map((b) => {
    const clientName = b.client?.name || 'Hola';
    const service = b.service?.name || 'tu visita';
    return {
      bookingId: b.id,
      clientName,
      service,
      text:
        `${clientName}, ¡gracias por elegir ${businessName}! Esperamos que hayas quedado conforme con ${service}. ` +
        `Cuando quieras coordinamos tu próxima cita — respondé este mensaje y la agendamos. 😊`,
    };
  });
}
