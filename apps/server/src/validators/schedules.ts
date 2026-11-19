import { z } from 'zod';
import { patchSchema } from './patch';
import { HH_MM_REGEX, timeToMinutes } from '../services/bookings/time';

const hhmm = z.string().regex(HH_MM_REGEX, 'Formato de hora inválido (HH:mm, de 00:00 a 23:59)');

/** Campos de un bloque de horario (sin la regla cruzada de hora de fin). */
const scheduleFields = z.object({
  dayOfWeek: z.number().int().min(1).max(7),
  startTime: hhmm,
  endTime: hhmm,
  professionalId: z.string().min(1),
  isActive: z.boolean().default(true),
});

/** La hora de fin tiene que ser posterior a la de inicio (comparadas en minutos). */
export function isEndAfterStart(startTime: string, endTime: string): boolean {
  return timeToMinutes(endTime) > timeToMinutes(startTime);
}

export const END_AFTER_START_MESSAGE = 'La hora de fin tiene que ser posterior a la de inicio';

/** Creación de un bloque de horario para un profesional. */
export const createScheduleSchema = scheduleFields.refine((v) => isEndAfterStart(v.startTime, v.endTime), {
  message: END_AFTER_START_MESSAGE,
  path: ['endTime'],
});

/**
 * Actualización parcial de un bloque de horario. Si vienen las dos horas se valida
 * acá; si viene una sola, la ruta la compara contra la guardada.
 */
export const updateScheduleSchema = patchSchema(scheduleFields).refine(
  (v) => v.startTime === undefined || v.endTime === undefined || isEndAfterStart(v.startTime, v.endTime),
  { message: END_AFTER_START_MESSAGE, path: ['endTime'] }
);

export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;
export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>;
