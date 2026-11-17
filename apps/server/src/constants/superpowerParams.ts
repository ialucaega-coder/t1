/**
 * Parámetros configurables por superpoder.
 *
 * Varios superpoderes inyectan texto en el prompt de sistema del bot (ver
 * services/chatbot.ts). Hasta ahora ese texto era fijo: el superpoder estaba
 * prendido o apagado y nada más. Esto agrega *personalización real*: cada
 * superpoder puede exponer parámetros (máximo de oraciones, intensidad del
 * cierre, escala de la encuesta, enlace de reseñas) que cambian el texto
 * efectivamente inyectado — el gap #1 contra ForjaBots.
 *
 * Los valores se guardan en el `Skill.config` (Json) existente, bajo la clave
 * `params`, así que no toca el schema congelado de Prisma. El backend es la
 * única fuente de verdad del spec: el GET /superpowers devuelve el spec junto a
 * los valores actuales para que el front renderice los controles sin duplicar.
 */

export type SuperpowerParamType = 'number' | 'select' | 'text';

export interface SuperpowerParamSpec {
  key: string;
  label: string;
  help?: string;
  type: SuperpowerParamType;
  default: number | string;
  /** number */
  min?: number;
  max?: number;
  /** select */
  options?: { value: string; label: string }[];
  /** text */
  maxLength?: number;
  placeholder?: string;
}

/**
 * Spec de parámetros por nombre de superpoder. Solo aparecen los que tienen
 * algo configurable; el resto siguen siendo simples on/off.
 */
export const SUPERPOWER_PARAM_SPECS: Record<string, SuperpowerParamSpec[]> = {
  'Turbo respuesta': [
    {
      key: 'maxOraciones',
      label: 'Máximo de oraciones por respuesta',
      help: 'Cuántas oraciones como mucho usa el bot antes de ir al grano.',
      type: 'number',
      default: 3,
      min: 1,
      max: 6,
    },
  ],
  'Cazador de ventas': [
    {
      key: 'intensidad',
      label: 'Intensidad del cierre',
      help: 'Qué tan insistente es el bot al empujar la venta.',
      type: 'select',
      default: 'media',
      options: [
        { value: 'suave', label: 'Suave — solo sugiere' },
        { value: 'media', label: 'Media — un empujón cálido' },
        { value: 'directa', label: 'Directa — propone cerrar ya' },
      ],
    },
  ],
  'Encuestas de satisfaccion': [
    {
      key: 'escalaMax',
      label: 'Escala de calificación',
      help: 'En qué rango le pide la nota al cliente.',
      type: 'select',
      default: '5',
      options: [
        { value: '5', label: 'Del 1 al 5' },
        { value: '10', label: 'Del 1 al 10' },
      ],
    },
  ],
  'Pide resenas Google': [
    {
      key: 'enlaceResenas',
      label: 'Enlace directo a tus reseñas de Google',
      help: 'El bot comparte este enlace cuando el cliente queda conforme.',
      type: 'text',
      default: '',
      maxLength: 500,
      placeholder: 'https://g.page/r/...',
    },
  ],
};

export type SuperpowerParams = Record<string, number | string>;

/** ¿Este superpoder tiene parámetros configurables? */
export function hasParams(name: string): boolean {
  return Array.isArray(SUPERPOWER_PARAM_SPECS[name]) && SUPERPOWER_PARAM_SPECS[name].length > 0;
}

function clampNumber(value: unknown, spec: SuperpowerParamSpec): number {
  const n = typeof value === 'number' ? value : Number(value);
  const fallback = spec.default as number;
  if (!Number.isFinite(n)) return fallback;
  const rounded = Math.round(n);
  const min = spec.min ?? Number.NEGATIVE_INFINITY;
  const max = spec.max ?? Number.POSITIVE_INFINITY;
  return Math.min(Math.max(rounded, min), max);
}

function sanitizeSelect(value: unknown, spec: SuperpowerParamSpec): string {
  const allowed = new Set((spec.options ?? []).map((o) => o.value));
  return typeof value === 'string' && allowed.has(value) ? value : (spec.default as string);
}

function sanitizeText(value: unknown, spec: SuperpowerParamSpec): string {
  if (typeof value !== 'string') return spec.default as string;
  return value.trim().slice(0, spec.maxLength ?? 500);
}

/**
 * Normaliza un objeto de params crudo contra el spec de un superpoder.
 * Devuelve SIEMPRE todas las claves del spec (con sus defaults si faltan o son
 * inválidas) y descarta claves desconocidas. Si el superpoder no tiene spec,
 * devuelve {}.
 */
export function sanitizeSuperpowerParams(name: string, raw: unknown): SuperpowerParams {
  const specs = SUPERPOWER_PARAM_SPECS[name];
  if (!specs) return {};
  const input = (raw && typeof raw === 'object' && !Array.isArray(raw))
    ? (raw as Record<string, unknown>)
    : {};
  const out: SuperpowerParams = {};
  for (const spec of specs) {
    const value = input[spec.key];
    if (spec.type === 'number') out[spec.key] = clampNumber(value, spec);
    else if (spec.type === 'select') out[spec.key] = sanitizeSelect(value, spec);
    else out[spec.key] = sanitizeText(value, spec);
  }
  return out;
}

/** Devuelve los params resueltos (defaults aplicados) para un superpoder. */
export function resolveSuperpowerParams(name: string, stored: unknown): SuperpowerParams {
  return sanitizeSuperpowerParams(name, stored);
}
