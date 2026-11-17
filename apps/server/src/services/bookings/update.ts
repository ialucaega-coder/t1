/**
 * Edición / reprogramación de reservas (servicio reutilizable).
 *
 * Misma validación que el alta (`create.ts`), scoped por negocio:
 *  - la reserva, el servicio y el profesional tienen que ser del negocio,
 *  - la hora de fin se recalcula con la duración del servicio resultante,
 *  - el re-chequeo de solape corre dentro de una transacción con el MISMO advisory
 *    lock por (negocio, profesional, día) que usa el alta, así una reprogramación y
 *    un alta simultáneos sobre la misma agenda se serializan (sin doble reserva).
 *    El solape excluye a la propia reserva (mover un turno 15 min no choca consigo
 *    mismo).
 *  - el estado se vuelve a leer DENTRO del lock: si la reserva se canceló entre la
 *    primera lectura y la transacción, la edición no se aplica (409).
 *
 * Una edición solo de notas no toca la agenda: no recalcula la hora de fin ni
 * chequea conflictos. Si cambia el servicio, el precio total pasa al del nuevo
 * servicio. No tiene efectos colaterales (socket/notificaciones): los maneja la ruta.
 * Lanza AppError 404 (reserva/servicio/profesional inexistente en el negocio),
 * 409 (reserva en estado final, servicio inactivo u horario ocupado) o 400 (sin cambios).
 */
import { prisma } from '../../lib/prisma';
import { AppError } from '../../middleware/errorHandler';
import { assertProfessionalInBusiness, bookingLockKey } from './create';
import { FINAL_BOOKING_STATUSES, bookingDateKey, computeEndTime, overlaps } from './time';

export interface UpdateBookingData {
  date?: string;
  startTime?: string;
  serviceId?: string;
  professionalId?: string;
  notes?: string;
}

const FINAL_EDIT_MESSAGE = 'No se puede editar una reserva cancelada, completada o ausente.';

const includeForResponse = {
  client: { select: { id: true, name: true, phone: true, email: true } },
  professional: { include: { user: { select: { name: true } } } },
  service: { select: { id: true, name: true, duration: true, price: true } },
};

export async function updateBooking(businessId: string, id: string, data: UpdateBookingData) {
  if (Object.values(data).every((v) => v === undefined)) {
    throw new AppError(400, 'No hay cambios para guardar');
  }

  const existing = await prisma.booking.findFirst({ where: { id, businessId } });
  if (!existing) throw new AppError(404, 'Reserva no encontrada');
  if (FINAL_BOOKING_STATUSES.includes(existing.status)) throw new AppError(409, FINAL_EDIT_MESSAGE);

  const serviceId = data.serviceId ?? existing.serviceId;
  const professionalId = data.professionalId ?? existing.professionalId;
  const startTime = data.startTime ?? existing.startTime;
  const date = data.date ?? existing.date.toISOString();
  const dateKey = bookingDateKey(date);

  const schedulingChanged =
    dateKey !== bookingDateKey(existing.date.toISOString()) ||
    startTime !== existing.startTime ||
    serviceId !== existing.serviceId ||
    professionalId !== existing.professionalId;

  // Solo notas: no se recalcula la hora de fin ni se chequean conflictos.
  if (!schedulingChanged) {
    try {
      return await prisma.booking.update({
        where: { id, businessId, status: { notIn: FINAL_BOOKING_STATUSES } },
        data: { notes: data.notes === '' ? null : data.notes },
        include: includeForResponse,
      });
    } catch (err) {
      // El estado pasó a final entre la lectura y el guardado.
      if ((err as { code?: string }).code === 'P2025') throw new AppError(409, FINAL_EDIT_MESSAGE);
      throw err;
    }
  }

  const service = await prisma.service.findFirst({ where: { id: serviceId, businessId } });
  if (!service || (serviceId !== existing.serviceId && service.deletedAt)) throw new AppError(404, 'Service not found');
  if (serviceId !== existing.serviceId && service.isActive === false) {
    throw new AppError(409, 'El servicio no está activo: no se pueden crear reservas para él.');
  }
  if (professionalId !== existing.professionalId) {
    await assertProfessionalInBusiness(businessId, professionalId);
  }

  const endTime = computeEndTime(startTime, service.duration);
  const lockKey = bookingLockKey(businessId, professionalId, date);

  const booking = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

    // El estado se relee ya adentro del lock: antes solo se miraba afuera y una
    // cancelación concurrente no se veía.
    const current = await tx.booking.findFirst({ where: { id, businessId }, select: { status: true } });
    if (!current) throw new AppError(404, 'Reserva no encontrada');
    if (FINAL_BOOKING_STATUSES.includes(current.status)) throw new AppError(409, FINAL_EDIT_MESSAGE);

    const sameDay = await tx.booking.findMany({
      where: {
        businessId,
        professionalId,
        date: new Date(dateKey),
        status: { notIn: ['CANCELLED'] },
        id: { not: id },
      },
      select: { startTime: true, endTime: true },
    });
    if (sameDay.some((b) => overlaps({ startTime, endTime }, b))) {
      return null;
    }

    return tx.booking.update({
      where: { id, businessId },
      data: {
        date: new Date(dateKey),
        startTime,
        endTime,
        serviceId,
        professionalId,
        ...(serviceId !== existing.serviceId ? { totalPrice: service.price } : {}),
        ...(data.notes !== undefined ? { notes: data.notes === '' ? null : data.notes } : {}),
      },
      include: includeForResponse,
    });
  });

  if (!booking) {
    throw new AppError(409, 'Ese horario ya está reservado para el profesional.');
  }
  return booking;
}
