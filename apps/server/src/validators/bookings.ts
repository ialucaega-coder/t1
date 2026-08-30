import { z } from 'zod';

const bookingStatusEnum = z.enum([
  'PENDING',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
]);

const bookingSourceEnum = z.enum(['WEB', 'TELEGRAM', 'WHATSAPP', 'VOICE', 'WALK_IN']);

/** Creación de un turno/reserva. */
export const createBookingSchema = z.object({
  date: z.string().min(1, 'La fecha es requerida'),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Formato de hora inválido (HH:mm)'),
  serviceId: z.string().min(1),
  professionalId: z.string().min(1),
  clientId: z.string().optional(),
  notes: z.string().optional(),
  source: bookingSourceEnum.default('WEB'),
});

/** Actualización del estado de un turno. */
export const updateBookingStatusSchema = z.object({
  status: bookingStatusEnum,
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type UpdateBookingStatusInput = z.infer<typeof updateBookingStatusSchema>;
