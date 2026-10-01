/**
 * Sincronización best-effort de una reserva de Local B hacia Cal.com.
 *
 * Se llama fire-and-forget desde la creación de reservas: NUNCA debe bloquear
 * ni romper el flujo de reserva. Si Cal.com no está conectado/habilitado, o
 * faltan datos (email, tipo de evento), o la API falla, simplemente no hace nada.
 */
import { loadCalcomConfig } from './config';
import { createBooking } from './client';

export interface BookingForSync {
  start: string | Date;
  clientName?: string | null;
  clientEmail?: string | null;
}

/**
 * Empuja una reserva a Cal.com si el negocio lo tiene conectado y habilitado.
 * Devuelve true si se creó en Cal.com, false si se omitió o falló (sin lanzar).
 */
export async function syncBookingToCalcom(businessId: string, booking: BookingForSync): Promise<boolean> {
  try {
    const cfg = await loadCalcomConfig(businessId);
    if (!cfg || !cfg.enabled || !cfg.eventTypeId) return false;
    if (!booking.clientEmail || !booking.clientName) return false;

    const start = booking.start instanceof Date ? booking.start.toISOString() : booking.start;
    await createBooking(cfg.apiKey, {
      eventTypeId: cfg.eventTypeId,
      start,
      name: booking.clientName,
      email: booking.clientEmail,
    });
    return true;
  } catch (err) {
    console.error('[calcom] No se pudo sincronizar la reserva (se ignora):', (err as Error).message);
    return false;
  }
}
