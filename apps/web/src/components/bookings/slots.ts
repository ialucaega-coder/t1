/**
 * Franjas horarias del formulario de reservas.
 *
 * Las franjas salen del horario de atención del profesional (endpoint
 * /professionals/:id/availability: pasos de 30 min dentro de su horario del día,
 * sin los ya ocupados) y de la duración del servicio elegido: una franja solo es
 * válida si TODAS las franjas que ocupa el servicio están libres.
 * Sin datos de disponibilidad se usan las franjas fijas de 30 min (8:00 a 20:00).
 */

export const SLOT_STEP_MIN = 30;

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function toTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Franjas fijas de 30 min de 08:00 a 20:00 (fallback cuando no hay horario cargado). */
export function fallbackTimeSlots(): string[] {
  const slots: string[] = [];
  for (let m = 8 * 60; m <= 20 * 60; m += SLOT_STEP_MIN) slots.push(toTime(m));
  return slots;
}

/** Franjas (HH:mm) que ocupa un turno [startTime, endTime) en pasos de 30 min. */
export function slotsOccupiedBy(startTime: string, endTime: string): string[] {
  const out: string[] = [];
  for (let m = toMinutes(startTime); m < toMinutes(endTime); m += SLOT_STEP_MIN) out.push(toTime(m));
  return out;
}

/**
 * Filtra las franjas libres según la duración del servicio: deja solo las que
 * tienen libres todas las franjas consecutivas que el servicio necesita.
 */
export function slotsForDuration(freeSlots: string[], durationMin: number): string[] {
  const free = new Set(freeSlots);
  const needed = Math.max(1, Math.ceil(durationMin / SLOT_STEP_MIN));
  return [...free]
    .sort()
    .filter((slot) => {
      const start = toMinutes(slot);
      for (let k = 1; k < needed; k++) {
        if (!free.has(toTime(start + k * SLOT_STEP_MIN))) return false;
      }
      return true;
    });
}
