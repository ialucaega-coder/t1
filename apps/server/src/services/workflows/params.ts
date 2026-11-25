/**
 * Parámetros configurables de las ACCIONES de una regla de automatización.
 *
 * Una regla guarda, junto a su `accion`, un objeto `params` (strings) en el mismo
 * JSON donde ya viven las reglas (Connection WORKFLOWS: sin schema nuevo). Acá
 * están, por acción:
 *  - la definición de los campos (para validar con zod y para que la UI pinte el
 *    formulario: `ParamFieldMeta`),
 *  - la validación estricta (al escribir) y el saneo tolerante (al leer),
 *  - el armado final de los params del executor mezclando regla + payload.
 *
 * ── Precedencia regla vs payload ────────────────────────────────────────────
 * El executor lee `params` con alias (ej: el texto puede venir como `body`,
 * `message`, `mensaje` o `texto`). Al armar los params de una ejecución:
 *   1. Parten del `payload` del evento, tal cual.
 *   2. Cada parámetro de la REGLA se agrega SOLO si el payload no trae ese dato
 *      (ni bajo su nombre ni bajo ninguno de sus alias). Si el payload lo trae,
 *      GANA EL PAYLOAD y el valor de la regla se ignora.
 * En el pipeline real los payloads no traen texto/etapa/título, así que la regla
 * manda; el payload solo pisa cuando alguien dispara a mano (`POST /run`) con un
 * valor explícito. Una regla vieja sin `params` se comporta exactamente igual que
 * antes (los params son el payload).
 *
 * ── Variables en textos ({{nombre}}) ────────────────────────────────────────
 * Los campos marcados `template` admiten `{{variable}}` o `{{variable|reemplazo}}`
 * (el reemplazo se usa si el dato no está). Variables disponibles: ver
 * `TEMPLATE_VARIABLES`. Seguridad: el render es de UNA sola pasada (lo que se
 * interpola nunca se vuelve a interpretar), los valores se insertan como texto
 * plano (sin saltos de línea ni caracteres de control/bidi, sin llaves) y con
 * largo tope; el resultado final también tiene tope.
 */
import { z } from 'zod';
import { LIFECYCLE_STAGES } from '../clients/lifecycle';

/** Tope del texto de un mensaje (WhatsApp / notificación). */
export const MAX_TEXT_LEN = 1000;
/** Tope del título de una notificación. */
export const MAX_TITLE_LEN = 120;
/** Tope de cada valor interpolado en un texto. */
const MAX_VALUE_LEN = 100;
/** Tope del texto de reemplazo de una variable ({{nombre|amigo}}). */
const MAX_FALLBACK_LEN = 40;

// ─── Variables de plantilla ─────────────────────────────────────────────

export interface TemplateVariable {
  key: string;
  label: string;
  example: string;
}

/** Variables disponibles en los textos con plantilla. */
export const TEMPLATE_VARIABLES: TemplateVariable[] = [
  { key: 'nombre', label: 'Nombre de pila del cliente', example: 'Lucía' },
  { key: 'monto', label: 'Monto del pago', example: '15.000' },
  { key: 'metodo_pago', label: 'Medio de pago', example: 'MERCADOPAGO' },
  { key: 'canal', label: 'Canal del mensaje', example: 'WHATSAPP' },
];

const VARIABLE_KEYS: ReadonlySet<string> = new Set(TEMPLATE_VARIABLES.map((v) => v.key));

// {{var}} o {{var|reemplazo}}. El reemplazo no puede contener llaves ni pipes.
const TOKEN_RE = new RegExp(`\\{\\{\\s*([a-z_]+)\\s*(?:\\|([^{}|]{0,${MAX_FALLBACK_LEN}}))?\\}\\}`, 'g');

/** Problemas de una plantilla (variables desconocidas, llaves sueltas). Vacío = OK. */
export function templateIssues(text: string): string[] {
  const issues: string[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    if (!VARIABLE_KEYS.has(m[1])) issues.push(`variable desconocida {{${m[1]}}}`);
  }
  const rest = text.replace(TOKEN_RE, '');
  if (rest.includes('{{') || rest.includes('}}')) {
    issues.push('hay llaves {{ }} mal formadas o sin cerrar');
  }
  return issues;
}

// Control, separadores de línea/párrafo (U+2028/9), invisibles y marcas bidi. Se arma
// con String.raw + RegExp para que los escapes queden explícitos en el código.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS_RE = new RegExp(String.raw`[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069]`, 'g');

/** Deja un valor como texto plano de una línea, sin llaves ni caracteres de control. */
function plain(value: unknown, max = MAX_VALUE_LEN): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(UNSAFE_CHARS_RE, ' ')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * Renderiza una plantilla en UNA sola pasada. Variable desconocida o sin dato →
 * su reemplazo (`{{v|reemplazo}}`) o vacío. Los valores nunca se re-interpretan.
 */
export function renderTemplate(
  text: string,
  ctx: Record<string, string | undefined>,
  max = MAX_TEXT_LEN,
): string {
  const out = text.replace(TOKEN_RE, (_m, key: string, fallback?: string) => {
    const value = VARIABLE_KEYS.has(key) ? plain(ctx[key]) : '';
    return value || plain(fallback, MAX_FALLBACK_LEN);
  });
  return out.trim().slice(0, max);
}

/**
 * Arma el contexto de variables a partir del payload del evento. `clientName` es
 * el nombre del cliente ya resuelto (scoped por negocio) por quien llama.
 */
export function buildTemplateContext(
  payload: Record<string, unknown> = {},
  clientName?: string | null,
): Record<string, string | undefined> {
  const name = plain(clientName ?? payload.nombre ?? payload.name);
  const amount = typeof payload.amount === 'number' && Number.isFinite(payload.amount)
    ? new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(payload.amount)
    : undefined;
  return {
    nombre: name ? name.split(' ')[0] : undefined,
    monto: amount,
    metodo_pago: typeof payload.paymentMethod === 'string' ? payload.paymentMethod : undefined,
    canal: typeof payload.channel === 'string' ? payload.channel : undefined,
  };
}

// ─── Definición de campos por acción ────────────────────────────────────

/** Metadatos de un campo para que la UI pinte el formulario. */
export interface ParamFieldMeta {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select';
  required: boolean;
  maxLength?: number;
  placeholder?: string;
  help?: string;
  /** El campo admite {{variables}}. */
  template?: boolean;
  options?: { value: string; label: string }[];
}

interface FieldDef extends ParamFieldMeta {
  /** Nombres alternativos con que el executor lee el mismo dato desde el payload. */
  aliases: string[];
}

const STAGE_LABELS: Record<string, string> = {
  NEW: 'Nuevo',
  HOT: 'Caliente',
  PAYMENT: 'En pago',
  CUSTOMER: 'Cliente',
};

/**
 * Campos por acción. SOLO las acciones expuestas en el catálogo tienen entrada;
 * para el resto, ver `NOT_EXPOSED_ACTIONS`. Los alias reflejan lo que lee
 * `services/actions/executor.ts` (si cambian allá, cambian acá).
 */
const ACTION_FIELDS: Record<string, FieldDef[]> = {
  enviar_whatsapp: [
    {
      key: 'texto',
      label: 'Mensaje',
      type: 'textarea',
      required: true,
      maxLength: MAX_TEXT_LEN,
      template: true,
      placeholder: 'Hola {{nombre|amigo}}, gracias por escribirnos.',
      help: 'Podés usar {{nombre}}, {{monto}}, {{metodo_pago}} y {{canal}}. Con {{nombre|amigo}} definís qué decir si falta el dato.',
      aliases: ['body', 'message', 'mensaje', 'texto'],
    },
  ],
  notificar: [
    {
      key: 'titulo',
      label: 'Título del aviso',
      type: 'text',
      required: false,
      maxLength: MAX_TITLE_LEN,
      template: true,
      placeholder: 'Nueva reserva',
      aliases: ['title', 'titulo'],
    },
    {
      key: 'texto',
      label: 'Texto del aviso',
      type: 'textarea',
      required: false,
      maxLength: MAX_TEXT_LEN,
      template: true,
      placeholder: '{{nombre|Un cliente}} acaba de reservar.',
      help: 'Si lo dejás vacío se usa un aviso genérico. Admite las mismas variables que el mensaje.',
      aliases: ['body', 'message', 'mensaje', 'texto'],
    },
  ],
  mover_lifecycle: [
    {
      key: 'etapa',
      label: 'Mover al cliente a la etapa',
      type: 'select',
      required: true,
      options: LIFECYCLE_STAGES.map((s) => ({ value: s, label: STAGE_LABELS[s] ?? s })),
      aliases: ['stage', 'etapa'],
    },
  ],
  // Sin campos: deriva la conversación del evento (conversationId del payload).
  asignar_agente: [],
};

/**
 * Acciones que el executor sabe correr pero NO se ofrecen en el catálogo de
 * reglas, con el motivo. Hoy la UI/regla no puede darles datos suficientes de
 * forma segura (los disparadores no traen esos datos y un valor fijo en la regla
 * no tiene sentido). Documentado acá y verificado por test.
 */
export const NOT_EXPOSED_ACTIONS: Record<string, string> = {
  crear_cliente: 'exige nombre y email y ningún disparador los trae; con valores fijos duplicaría el mismo cliente en cada evento',
  generar_link_pago: 'solo devuelve la URL al resultado de la ejecución: nada se la entrega al cliente (falta el paso de envío)',
  lanzar_campana: 'es un envío masivo disparado por eventos individuales; hace falta una decisión del dueño sobre límites y confirmación',
  crear_reserva: 'exige servicio, fecha, hora, profesional y cliente; ningún disparador los trae y fijarlos en la regla no tiene sentido',
};

/** Metadatos de los campos de una acción (sin alias), para el catálogo. */
export function paramFieldsFor(action: string): ParamFieldMeta[] {
  return (ACTION_FIELDS[action] ?? []).map(({ aliases: _aliases, ...meta }) => meta);
}

// ─── Validación (estricta al escribir) ──────────────────────────────────

function fieldSchema(f: FieldDef): z.ZodType<string> {
  const required = (iss: { input?: unknown }) =>
    iss.input === undefined ? `${f.label} es obligatorio` : `${f.label} debe ser texto`;
  if (f.type === 'select') {
    const values = (f.options ?? []).map((o) => o.value) as [string, ...string[]];
    return z.enum(values, { error: () => `${f.label}: elegí una opción válida` });
  }
  const base = z.string({ error: required }).trim().min(1, `${f.label} es obligatorio`)
    .max(f.maxLength ?? MAX_TEXT_LEN, `${f.label}: máximo ${f.maxLength ?? MAX_TEXT_LEN} caracteres`);
  if (!f.template) return base;
  return base.superRefine((value, ctx) => {
    for (const issue of templateIssues(value)) {
      ctx.addIssue({ code: 'custom', message: `${f.label}: ${issue}` });
    }
  });
}

/** Schema zod estricto de los params de una acción (claves desconocidas = error). */
export function paramsSchemaFor(action: string): z.ZodType<Record<string, string>> {
  const fields = ACTION_FIELDS[action] ?? [];
  const shape: Record<string, z.ZodType<string>> = {};
  for (const f of fields) {
    const base = fieldSchema(f);
    shape[f.key] = f.required ? base : (base.optional() as unknown as z.ZodType<string>);
  }
  return z.strictObject(shape) as unknown as z.ZodType<Record<string, string>>;
}

export interface ParamIssue {
  field: string;
  message: string;
}

export type ParamsValidation =
  | { ok: true; params: Record<string, string> | undefined }
  | { ok: false; issues: ParamIssue[] };

/**
 * Valida (estricto) los params de una acción. Los strings vacíos de campos
 * opcionales se descartan; el resultado sin ninguna clave se devuelve como
 * `undefined` (la regla queda sin `params`).
 */
export function validateRuleParams(action: string, raw: unknown): ParamsValidation {
  if (raw !== undefined && raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) {
    return { ok: false, issues: [{ field: 'params', message: 'params debe ser un objeto' }] };
  }
  const input: Record<string, unknown> = {};
  for (const [k, v] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim() === '') continue; // vacío = no enviado
    input[k] = v;
  }
  const parsed = paramsSchemaFor(action).safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        field: ['params', ...i.path.map(String)].join('.'),
        message: i.message,
      })),
    };
  }
  const params = parsed.data;
  return { ok: true, params: Object.keys(params).length > 0 ? params : undefined };
}

/**
 * Saneo TOLERANTE para datos ya guardados (lectura): solo claves conocidas de la
 * acción y strings recortados al tope. No rechaza nada (una regla guardada nunca
 * debe desaparecer por un cambio de reglas de validación).
 */
export function sanitizeParams(action: string, raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const f of ACTION_FIELDS[action] ?? []) {
    const v = (raw as Record<string, unknown>)[f.key];
    if (typeof v !== 'string' || !v.trim()) continue;
    out[f.key] = v.trim().slice(0, f.maxLength ?? MAX_TEXT_LEN);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// ─── Ejecución: regla + payload ─────────────────────────────────────────

function hasValue(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  return !(typeof v === 'string' && v.trim() === '');
}

/** ¿Algún campo de la acción usa plantillas con la variable `nombre`? (evita un lookup si no hace falta) */
export function needsClientName(action: string, ruleParams: Record<string, string> | undefined): boolean {
  if (!ruleParams) return false;
  return (ACTION_FIELDS[action] ?? []).some(
    (f) => f.template && /\{\{\s*nombre\b/.test(ruleParams[f.key] ?? ''),
  );
}

/**
 * Params finales para el executor: payload + params de la regla, con la
 * precedencia descripta arriba (el payload gana donde trae el dato). Los campos
 * `template` se renderizan con `ctx`. Sin params de regla devuelve una copia del
 * payload (compat con reglas viejas).
 */
export function buildActionParams(
  action: string,
  ruleParams: Record<string, string> | undefined,
  payload: Record<string, unknown> = {},
  ctx: Record<string, string | undefined> = {},
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...payload };
  if (!ruleParams) return merged;
  for (const f of ACTION_FIELDS[action] ?? []) {
    const raw = ruleParams[f.key];
    if (!raw) continue;
    if ([f.key, ...f.aliases].some((k) => hasValue(payload[k]))) continue; // el payload manda
    const value = f.template ? renderTemplate(raw, ctx, f.maxLength ?? MAX_TEXT_LEN) : raw;
    if (value) merged[f.key] = value;
  }
  return merged;
}
