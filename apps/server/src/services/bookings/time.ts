/**
 * Helpers de horario de reservas. Las horas se guardan como strings HH:mm, pero se
 * COMPARAN siempre como minutos enteros: la comparación lexicográfica de strings
 * se rompe con formatos raros ('100:00' < '20:00') y con el fin de día ('24:00').
 */
import type { BookingStatus } from '@prisma/client';
import { AppError } from '../../middleware/errorHandler';

/** HH:mm estricto: HH 00-23, MM 00-59 (antes aceptaba '99:99'). */
export const HH_MM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export const DAY_MINUTES = 1440;
export const MAX_SERVICE_DURATION_MIN = 1440;

/** Argentina no tiene horario de verano: el offset es fijo. */
export const ARGENTINA_OFFSET = '-03:00';

/** HH:mm → minutos desde las 00:00. Acepta '24:00' (fin de día de un turno guardado). */
export function timeToMinutes(time: string): number {
  const match = /^(\d{1,3}):(\d{2})$/.exec(time);
  if (!match) return Number.NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Minutos → HH:mm (1440 → '24:00'). */
export function minutesToTime(minutes: number): string {
  return `${Math.floor(minutes / 60).toString().padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}`;
}

/** Día normalizado a YYYY-MM-DD (UTC). Lanza AppError(400) si la fecha no se puede interpretar. */
export function bookingDateKey(date: string): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) throw new AppError(400, 'Fecha inválida');
  return parsed.toISOString().slice(0, 10);
}

/**
 * Instante real del turno (para Cal.com): fecha normalizada + hora, en hora de
 * Argentina (-03:00). Antes se armaba `${date}T${hora}:00` sin offset, así que la
 * hora quedaba corrida según la zona del servidor y daba Invalid Date si `date`
 * traía hora.
 */
export function bookingInstant(date: string, startTime: string): Date {
  return new Date(`${bookingDateKey(date)}T${startTime}:00${ARGENTINA_OFFSET}`);
}

/**
 * Hora de fin (HH:mm) = inicio + duración del servicio. Valida: hora de inicio
 * válida, duración de 1 a 1440 min y que el turno no cruce la medianoche (fin
 * máximo 24:00).
 */
export function computeEndTime(startTime: string, durationMinutes: number): string {
  if (!HH_MM_REGEX.test(startTime)) throw new AppError(400, 'Hora de inicio inválida (HH:mm)');
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > MAX_SERVICE_DURATION_MIN) {
    throw new AppError(400, 'La duración del servicio es inválida (debe ser de 1 a 1440 minutos).');
  }
  const end = timeToMinutes(startTime) + durationMinutes;
  if (end > DAY_MINUTES) {
    throw new AppError(400, 'El turno no puede terminar después de las 24:00 (no puede cruzar la medianoche).');
  }
  return minutesToTime(end);
}

/** Dos turnos del mismo día se solapan si cada uno empieza antes de que termine el otro (en minutos). */
export function overlaps(a: { startTime: string; endTime: string }, b: { startTime: string; endTime: string }): boolean {
  return timeToMinutes(a.startTime) < timeToMinutes(b.endTime) && timeToMinutes(a.endTime) > timeToMinutes(b.startTime);
}

/** Estados finales: la reserva ya no se puede reabrir ni editar. */
export const FINAL_BOOKING_STATUSES: BookingStatus[] = ['CANCELLED', 'COMPLETED', 'NO_SHOW'];
