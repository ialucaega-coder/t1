/**
 * Motor de creación de reservas (servicio reutilizable).
 *
 * Extraído del handler `POST /api/bookings` para que esa ruta Y el executor de
 * automatizaciones (acción `crear_reserva`) compartan la MISMA lógica, sin
 * duplicar la validación ni —sobre todo— el chequeo de conflictos de agenda.
 *
 * Qué hace (todo scoped por negocio, multi-tenant):
 *  - valida que el servicio sea del negocio (precio/duración),
 *  - valida que el cliente (si no es el propio usuario que agenda) sea del negocio,
 *  - calcula la hora de fin desde la duración del servicio,
 *  - crea el turno dentro de una transacción con advisory lock por
 *    (negocio, profesional, día) + re-chequeo de solape, para no agendar dos
 *    turnos del mismo profesional a la misma hora.
 *
 * NO hace efectos colaterales (notificar, socket, Cal.com, disparar
 * automatizaciones): esos quedan en el llamador (la ruta), para no acoplarlos ni
 * arriesgar loops (una automatización que crea una reserva no debe re-disparar
 * el trigger `nueva_reserva`). Lanza AppError(404) si no existe el servicio/cliente
 * y AppError(409) si el horario se solapa.
 */
import { prisma } from '../../lib/prisma';
import { AppError } from '../../middleware/errorHandler';

export type BookingSource = 'WEB' | 'TELEGRAM' | 'WHATSAPP' | 'VOICE' | 'WALK_IN';

export interface CreateBookingData {
  serviceId: string;
  /** Fecha (YYYY-MM-DD o ISO). */
  date: string;
  /** Hora de inicio HH:mm. */
  startTime: string;
  /** Profesional asignado (requerido por el modelo de reservas). */
  professionalId: string;
  clientId?: string;
  notes?: string;
  source?: BookingSource;
}

/**
 * Crea una reserva. `actingUserId` es el usuario que agenda: si no se pasa
 * `clientId`, la reserva se crea para él (caso del portal/panel); si se pasa un
 * `clientId` distinto, se valida que pertenezca al negocio. Para llamadas sin un
 * usuario "propio" (ej: automatizaciones), pasar `clientId` y un `actingUserId`
 * vacío fuerza esa validación.
 */
export async function createBooking(
  businessId: string,
  data: CreateBookingData,
  actingUserId: string,
) {
  // Servicio del negocio (precio/duración). Scoped: no se puede reservar contra
  // el servicio de otro tenant.
  const service = await prisma.service.findFirst({
    where: { id: data.serviceId, businessId },
  });
  if (!service) throw new AppError(404, 'Service not found');

  const effectiveClientId = data.clientId || actingUserId;
  if (!effectiveClientId) throw new AppError(400, 'Falta el cliente de la reserva');

  // Si el cliente no es el propio usuario que agenda, validar que sea del negocio.
  if (effectiveClientId !== actingUserId) {
    const client = await prisma.user.findFirst({
      where: { id: effectiveClientId, businessId },
      select: { id: true },
    });
    if (!client) throw new AppError(404, 'Cliente no encontrado en este negocio');
  }

  const [hours, minutes] = data.startTime.split(':').map(Number);
  const endMinutes = hours * 60 + minutes + service.duration;
  const endTime = `${Math.floor(endMinutes / 60).toString().padStart(2, '0')}:${(endMinutes % 60).toString().padStart(2, '0')}`;

  // Reserva atómica: advisory lock por (negocio, profesional, día) + re-chequeo
  // de solape dentro de la transacción, para no agendar dos turnos del mismo
  // profesional a la misma hora.
  const lockKey = `booking:${businessId}:${data.professionalId}:${data.date}`;
  const booking = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
    const sameDay = await tx.booking.findMany({
      where: {
        businessId,
        professionalId: data.professionalId,
        date: new Date(data.date),
        status: { notIn: ['CANCELLED'] },
      },
      select: { startTime: true, endTime: true },
    });
    if (sameDay.some((b) => data.startTime < b.endTime && endTime > b.startTime)) {
      return null;
    }

    return tx.booking.create({
      data: {
        date: new Date(data.date),
        startTime: data.startTime,
        endTime,
        totalPrice: service.price,
        source: data.source ?? 'WEB',
        notes: data.notes,
        clientId: effectiveClientId,
        professionalId: data.professionalId,
        serviceId: data.serviceId,
        businessId,
      },
      include: {
        client: { select: { name: true, phone: true, email: true } },
        professional: { include: { user: { select: { name: true } } } },
        service: { select: { name: true, duration: true } },
      },
    });
  });

  if (!booking) {
    throw new AppError(409, 'Ese horario ya está reservado para el profesional.');
  }
  return booking;
}
