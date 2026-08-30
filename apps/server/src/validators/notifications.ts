import { z } from 'zod';

const notificationTypeEnum = z.enum([
  'BOOKING_CREATED',
  'BOOKING_CONFIRMED',
  'BOOKING_REMINDER',
  'BOOKING_CANCELLED',
  'ORDER_STATUS',
  'PROMOTION',
  'GENERAL',
]);
const notificationChannelEnum = z.enum(['EMAIL', 'WHATSAPP', 'TELEGRAM', 'SMS', 'PUSH']);

/** Creación de una notificación. */
export const createNotificationSchema = z.object({
  type: notificationTypeEnum,
  channel: notificationChannelEnum,
  title: z.string().min(1),
  body: z.string().min(1),
  userId: z.string().min(1),
});

export type CreateNotificationInput = z.infer<typeof createNotificationSchema>;
