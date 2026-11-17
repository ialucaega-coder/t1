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
 *
 * Si cambia el servicio, el precio total se actualiza al del nuevo servicio. No
 * tiene efectos colaterales (socket/notificaciones): los maneja la ruta.
 * Lanza AppError 404 (reserva/servicio/profesional inexistente en el negocio),
 * 409 (reserva en estado final o horario ocupado) o 400 (sin cambios).
 */
import { prisma } from '../../lib/prisma';
import { AppError } from '../../middleware/errorHandler';
import {
  assertProfessionalInBusiness,
  bookingDateKey,
  bookingLockKey,
  computeEndTime,
  overlaps,
} from './create';

/** Estados finales: la reserva ya no se puede mover ni editar. */
const FINAL_STATUSES = ['CANCELLED', 'COMPLETED', 'NO_SHOW'];

export interface UpdateBookingData {
  date?: string;
  startTime?: string;
  serviceId?: string;
  professionalId?: string;
  notes?: string;
}

export async function updateBooking(businessId: string, id: string, data: UpdateBookingData) {
  if (Object.values(data).every((v) => v === undefined)) {
    throw new AppError(400, 'No hay cambios para guardar');
  }

  const existing = await prisma.booking.findFirst({ where: { id, businessId } });
  if (!existing) throw new AppError(404, 'Reserva no encontrada');
  if (FINAL_STATUSES.includes(existing.status)) {
    throw new AppError(409, 'No se puede editar una reserva cancelada, completada o ausente.');
  }

  const serviceId = data.serviceId ?? existing.serviceId;
  const professionalId = data.professionalId ?? existing.professionalId;
  const startTime = data.startTime ?? existing.startTime;
  const date = data.date ?? existing.date.toISOString();
  const dateKey = bookingDateKey(date);

  const service = await prisma.service.findFirst({ where: { id: serviceId, businessId } });
  if (!service) throw new AppError(404, 'Service not found');
  if (professionalId !== existing.professionalId) {
    await assertProfessionalInBusiness(businessId, professionalId);
  }

  const endTime = computeEndTime(startTime, service.duration);
  const lockKey = bookingLockKey(businessId, professionalId, date);

  const booking = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
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
      include: {
        client: { select: { id: true, name: true, phone: true, email: true } },
        professional: { include: { user: { select: { name: true } } } },
        service: { select: { id: true, name: true, duration: true, price: true } },
      },
    });
  });

  if (!booking) {
    throw new AppError(409, 'Ese horario ya está reservado para el profesional.');
  }
  return booking;
}
