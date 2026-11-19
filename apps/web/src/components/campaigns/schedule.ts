/**
 * Utilidades de programación de campañas.
 *
 * Todo el panel trabaja en hora de Argentina (America/Argentina/Buenos_Aires,
 * UTC-3 fijo, sin horario de verano). El selector de fecha y hora se interpreta
 * como hora argentina sin importar la zona del navegador, y el server recibe un
 * ISO en UTC (su validación `z.string().datetime()` exige el formato con "Z").
 */

export const AR_TIMEZONE = 'America/Argentina/Buenos_Aires';
export const AR_OFFSET_HOURS = 3; // Argentina = UTC-3
const HOUR_MS = 60 * 60 * 1000;

/** El server no envía una campaña que lleva más de esto vencida (services/campaigns/dispatch). */
export const MAX_LATE_MS = 6 * HOUR_MS;

/** "YYYY-MM-DDTHH:mm" (hora argentina, como el input datetime-local) → ISO UTC; null si es inválido. */
export function argentinaInputToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const d = new Date(`${value}:00-03:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** ISO/Date → "YYYY-MM-DDTHH:mm" en hora argentina (para el input datetime-local). */
export function isoToArgentinaInput(iso: string | Date): string {
  const ms = (iso instanceof Date ? iso : new Date(iso)).getTime();
  return new Date(ms - AR_OFFSET_HOURS * HOUR_MS).toISOString().slice(0, 16);
}

/** Fecha y hora legibles en hora argentina, ej "15/11/2026, 18:30". */
export function formatArgentina(iso: string | Date): string {
  return new Date(iso).toLocaleString('es-AR', {
    timeZone: AR_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * Valida el valor del selector. Devuelve el ISO UTC listo para enviar o un
 * mensaje de error (fecha inválida o en el pasado).
 */
export function validateScheduleInput(value: string, now: number = Date.now()): { iso: string } | { error: string } {
  const iso = argentinaInputToIso(value);
  if (!iso) return { error: 'Elegí una fecha y hora válidas.' };
  if (new Date(iso).getTime() <= now) return { error: 'La fecha y hora tienen que ser futuras (hora de Argentina).' };
  return { iso };
}

export interface CampaignStatusInfo {
  label: string;
  description?: string;
  /** Clases de color (el texto de `label` es la señal principal, no el color). */
  className: string;
}

export type CampaignFailReason = 'retries_exhausted' | 'expired';

/** Payload del evento de socket 'campaign:failed' (el server puede omitir `envio`). */
export interface CampaignFailedEvent {
  campaign?: { id?: string; name?: string };
  envio?: { enviados?: number; fallidos?: number };
  reason?: CampaignFailReason | string;
}

/** Payload de 'campaign:sent' (solo usamos el id para limpiar el avance en vivo). */
export interface CampaignSentEvent {
  campaign?: { id?: string };
}

/** Avance de un envío en curso (evento 'campaign:progress'). */
export interface CampaignProgress {
  enviados: number;
  fallidos: number;
  procesados: number;
  total: number;
}

export interface CampaignProgressEvent {
  campaignId?: string;
  progress?: CampaignProgress;
}

/** Porcentaje entero 0-100 (acotado; con total 0 no hay avance que mostrar). */
export function campaignProgressPercent(p: Pick<CampaignProgress, 'procesados' | 'total'>): number {
  if (!p.total || p.total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((p.procesados / p.total) * 100)));
}

/** Texto del toast de error según el motivo informado por el server. */
export function campaignFailedMessage(name: string, reason?: string, envio?: { fallidos?: number }): string {
  if (reason === 'expired') {
    return `La campaña ${name} no se envió: venció la hora programada hace más de 6 h`;
  }
  const n = envio?.fallidos;
  if (typeof n === 'number' && n > 0) {
    return `No se pudo enviar la campaña ${name}: ${n} ${n === 1 ? 'mensaje falló' : 'mensajes fallaron'}`;
  }
  return `No se pudo enviar la campaña ${name}`;
}

interface StatusSource {
  status: string;
  scheduledAt: string | null;
  updatedAt?: string;
  /** Motivo informado en vivo por el evento 'campaign:failed' (si no hay, se infiere). */
  failReason?: CampaignFailReason | string;
}

/**
 * Estado visible de una campaña: siempre con texto. Para 'failed' el server no
 * guarda el motivo: se infiere. Si pasó más de 6 h entre la hora programada y la
 * última actualización, fue el vencimiento (el despachador no envía tarde); si no,
 * falló el envío en sí.
 */
export function describeCampaignStatus(c: StatusSource): CampaignStatusInfo {
  switch (c.status) {
    case 'scheduled':
      return {
        label: 'Programada',
        description: c.scheduledAt ? `Se envía el ${formatArgentina(c.scheduledAt)} (hora de Argentina)` : undefined,
        className: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      };
    case 'sending':
      return {
        label: 'Enviando…',
        description: 'Se está enviando a tus clientes. Cuando termina, el estado se actualiza solo.',
        className: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
      };
    case 'sent':
      return { label: 'Enviada', className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' };
    case 'failed': {
      const expired = c.failReason
        ? c.failReason === 'expired'
        : !!c.scheduledAt &&
          !!c.updatedAt &&
          new Date(c.updatedAt).getTime() - new Date(c.scheduledAt).getTime() > MAX_LATE_MS;
      return {
        label: 'No se envió',
        description: expired
          ? 'No se envió: venció la hora programada hace más de 6 h. Podés enviarla ahora si todavía tiene sentido.'
          : 'El envío falló. Podés reintentarlo con "Enviar ahora".',
        className: 'bg-red-500/10 text-red-400 border-red-500/20',
      };
    }
    case 'cancelled':
      return {
        label: 'Cancelada',
        description: 'Está cancelada y no se puede enviar.',
        className: 'bg-slate-500/10 text-slate-300 border-slate-500/20',
      };
    default:
      return { label: 'Borrador', className: 'bg-slate-500/10 text-slate-400 border-slate-500/20' };
  }
}
