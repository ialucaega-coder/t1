/**
 * Resumen legible y saneado de lo que Mr Go quiere ejecutar (`pending.params`) y de
 * cómo terminó la acción confirmada. Lo usan la tarjeta "Ask me" de la Oficina y el
 * CommandPanel, para que el dueño vea QUÉ aprueba (a quién, qué texto, cuánto) y no
 * solo el nombre del tool.
 *
 * Solo se muestran campos conocidos (lista blanca) y siempre como TEXTO: nada de
 * volcar el objeto crudo, y los datos de contacto salen enmascarados parcialmente.
 */
import type { AgentStep } from '@/lib/api/mrgo';

export interface PendingParamRow {
  label: string;
  value: string;
}

const MAX_TEXT = 300;
const MAX_SHORT = 80;

/** Quita caracteres de control, colapsa espacios y recorta con "…". */
export function sanitizeText(value: unknown, max = MAX_SHORT): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  // eslint-disable-next-line no-control-regex
  const clean = String(value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** "+5491155551234" → "+54•••••234" (prefijo y últimos 3 dígitos; el resto, oculto). */
export function maskPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length <= 5) return '••••';
  const plus = raw.trim().startsWith('+') ? '+' : '';
  return `${plus}${digits.slice(0, 2)}•••••${digits.slice(-3)}`;
}

/** "ana@dominio.com" → "a••@dominio.com". */
export function maskEmail(raw: string): string {
  const at = raw.indexOf('@');
  if (at < 1) return '••••';
  return `${raw[0]}••${raw.slice(at)}`;
}

function pick(params: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = params[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function formatAmount(raw: unknown, currency: unknown): string {
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
  if (!Number.isFinite(n)) return sanitizeText(raw);
  const cur = typeof currency === 'string' && /^[A-Za-z]{3}$/.test(currency) ? ` ${currency.toUpperCase()}` : '';
  return `$ ${n.toLocaleString('es-AR')}${cur}`;
}

/** Filas "etiqueta: valor" de los parámetros que Mr Go quiere usar. */
export function summarizePendingParams(params: Record<string, unknown> | undefined | null): PendingParamRow[] {
  if (!params || typeof params !== 'object') return [];
  const rows: PendingParamRow[] = [];

  const phone = pick(params, 'to', 'phone', 'telefono');
  if (phone !== undefined) rows.push({ label: 'Destinatario', value: maskPhone(sanitizeText(phone, 40)) });

  const name = pick(params, 'name', 'nombre');
  if (name !== undefined) rows.push({ label: 'Nombre', value: sanitizeText(name) });

  const email = pick(params, 'email', 'correo');
  if (email !== undefined) rows.push({ label: 'Email', value: maskEmail(sanitizeText(email, 120)) });

  // Sin teléfono explícito, el destinatario es un cliente por id.
  const clientId = pick(params, 'clientId', 'cliente', 'userId');
  if (clientId !== undefined && phone === undefined) {
    rows.push({ label: 'Cliente', value: sanitizeText(clientId, 40) });
  }

  const message = pick(params, 'body', 'message', 'mensaje', 'texto');
  if (message !== undefined) rows.push({ label: 'Mensaje', value: sanitizeText(message, MAX_TEXT) });

  const amount = pick(params, 'amount', 'monto', 'importe');
  if (amount !== undefined) rows.push({ label: 'Monto', value: formatAmount(amount, pick(params, 'currency', 'moneda')) });

  const concept = pick(params, 'title', 'titulo', 'descripcion', 'description', 'concepto');
  if (concept !== undefined) rows.push({ label: 'Concepto', value: sanitizeText(concept, 120) });

  const campaign = pick(params, 'campaignName', 'campanaNombre', 'nombreCampana', 'campaignId', 'campanaId', 'campana');
  if (campaign !== undefined) rows.push({ label: 'Campaña', value: sanitizeText(campaign, 120) });

  const date = pick(params, 'date', 'fecha');
  const time = pick(params, 'startTime', 'hora', 'horaInicio');
  if (date !== undefined || time !== undefined) {
    rows.push({ label: 'Fecha y hora', value: [sanitizeText(date, 20), sanitizeText(time, 10)].filter(Boolean).join(' ') });
  }

  const stage = pick(params, 'stage', 'etapa');
  if (stage !== undefined) rows.push({ label: 'Etapa', value: sanitizeText(stage, 40) });

  return rows.filter((r) => r.value !== '');
}

export interface StepIssue {
  level: 'error' | 'warning';
  message: string;
}

/**
 * Mira el ÚLTIMO paso de la corrida (el de la acción recién confirmada): si no se
 * ejecutó de verdad (error, omitido, no soportado o solo simulado) devuelve el aviso
 * con el motivo; si salió bien, null. Antes se mostraba "Listo" siempre.
 */
export function lastStepIssue(steps: AgentStep[] | undefined, toolName: (key: string) => string): StepIssue | null {
  const last = steps && steps.length > 0 ? steps[steps.length - 1] : undefined;
  if (!last) return null;
  const { result } = last;
  const name = toolName(last.tool);
  const detail = sanitizeText(result.detail, 200);
  const why = detail ? `: ${detail}` : '.';
  if (result.status === 'error') {
    return { level: 'error', message: `No se pudo ejecutar ${name}${why}` };
  }
  if (result.status === 'omitido') return { level: 'warning', message: `La acción ${name} se omitió${why}` };
  if (result.status === 'no_soportado') return { level: 'warning', message: `La acción ${name} no está soportada${why}` };
  if (result.status === 'simulado') {
    return { level: 'warning', message: `La acción ${name} solo se simuló, no se ejecutó de verdad${why}` };
  }
  // Cualquier otro estado con ok=false también es un fallo.
  if (result.ok === false) return { level: 'error', message: `No se pudo ejecutar ${name}${why}` };
  return null;
}
