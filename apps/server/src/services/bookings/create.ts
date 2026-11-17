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

/** Día de la reserva normalizado a YYYY-MM-DD (UTC): base de la fecha guardada y de la clave del lock. */
export function bookingDateKey(date: string): string {
  return new Date(date).toISOString().slice(0, 10);
}

/** Hora de fin (HH:mm) = inicio + duración del servicio. */
export function computeEndTime(startTime: string, durationMinutes: number): string {
  const [hours, minutes] = startTime.split(':').map(Number);
  const endMinutes = hours * 60 + minutes + durationMinutes;
  return `${Math.floor(endMinutes / 60).toString().padStart(2, '0')}:${(endMinutes % 60).toString().padStart(2, '0')}`;
}

/**
 * Lock de agenda por (negocio, profesional, día). La clave se arma con la fecha
 * NORMALIZADA: antes usaba el string crudo, así que '2026-01-01' y
 * '2026-01-01T00:00:00Z' tomaban locks distintos para el mismo día y dos altas
 * simultáneas podían pisarse. Compartida por alta y edición/reprogramación.
 */
export function bookingLockKey(businessId: string, professionalId: string, date: string): string {
  return `booking:${businessId}:${professionalId}:${bookingDateKey(date)}`;
}

/** Dos turnos del mismo día se solapan si cada uno empieza antes de que termine el otro. */
export function overlaps(a: { startTime: string; endTime: string }, b: { startTime: string; endTime: string }): boolean {
  return a.startTime < b.endTime && a.endTime > b.startTime;
}

/** El profesional tiene que ser del negocio (multi-tenant). Lanza AppError(404) si no. */
export async function assertProfessionalInBusiness(businessId: string, professionalId: string) {
  const professional = await prisma.professional.findFirst({
    where: { id: professionalId, businessId },
    select: { id: true },
  });
  if (!professional) throw new AppError(404, 'Profesional no encontrado en este negocio');
}

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

  await assertProfessionalInBusiness(businessId, data.professionalId);

  const endTime = computeEndTime(data.startTime, service.duration);
  const dateKey = bookingDateKey(data.date);

  // Reserva atómica: advisory lock por (negocio, profesional, día) + re-chequeo
  // de solape dentro de la transacción, para no agendar dos turnos del mismo
  // profesional a la misma hora.
  const lockKey = bookingLockKey(businessId, data.professionalId, data.date);
  const booking = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
    const sameDay = await tx.booking.findMany({
      where: {
        businessId,
        professionalId: data.professionalId,
        date: new Date(dateKey),
        status: { notIn: ['CANCELLED'] },
      },
      select: { startTime: true, endTime: true },
    });
    if (sameDay.some((b) => overlaps({ startTime: data.startTime, endTime }, b))) {
      return null;
    }

    return tx.booking.create({
      data: {
        date: new Date(dateKey),
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
