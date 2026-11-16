import { z } from 'zod';
import { patchSchema } from './patch';

const bookingStatusEnum = z.enum([
  'PENDING',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
]);

const bookingSourceEnum = z.enum(['WEB', 'TELEGRAM', 'WHATSAPP', 'VOICE', 'WALK_IN']);

/** Fecha de la reserva: YYYY-MM-DD o ISO; tiene que ser parseable (si no, el alta reventaba con 500). */
const bookingDate = z
  .string()
  .min(1, 'La fecha es requerida')
  .refine((v) => !Number.isNaN(new Date(v).getTime()), 'Fecha inválida');

/** Creación de un turno/reserva. */
export const createBookingSchema = z.object({
  date: bookingDate,
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Formato de hora inválido (HH:mm)'),
  serviceId: z.string().min(1),
  professionalId: z.string().min(1),
  clientId: z.string().optional(),
  notes: z.string().optional(),
  source: bookingSourceEnum.default('WEB'),
});

/**
 * Edición/reprogramación de un turno (PATCH /bookings/:id): fecha, hora, servicio,
 * profesional y notas. Parcial y SIN defaults (patchSchema). El cliente, el origen y
 * el estado no se tocan por acá. `notes: ''` borra las notas.
 */
export const updateBookingSchema = patchSchema(
  z.object({
    date: bookingDate,
    startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Formato de hora inválido (HH:mm)'),
    serviceId: z.string().min(1),
    professionalId: z.string().min(1),
    notes: z.string().max(2000),
  })
);

/** Actualización del estado de un turno. */
export const updateBookingStatusSchema = z.object({
  status: bookingStatusEnum,
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type UpdateBookingInput = z.infer<typeof updateBookingSchema>;
export type UpdateBookingStatusInput = z.infer<typeof updateBookingStatusSchema>;
