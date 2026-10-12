/**
 * Workflows / automatización (reglas trigger → condición → acción).
 *
 * Cierra el gap vs SalesMartly: el dueño crea reglas del tipo "cuando pasa X
 * (trigger), si se cumple Y (condición), hacé Z (acción)" y las activa/desactiva.
 *
 * Alcance v1: CRUD + catálogo + evaluación (selección de reglas que matchean un
 * evento). La EJECUCIÓN real de los efectos (enviar WhatsApp, asignar agente,
 * etc.) NO se cablea todavía al pipeline de mensajes/eventos; `evaluateWorkflows`
 * deja la interfaz lista pero por ahora solo devuelve las reglas candidatas, sin
 * producir efectos. El cableado a eventos es un paso posterior (toca archivos
 * compartidos del pipeline).
 *
 * Persistencia: el schema de Prisma está congelado, así que guardamos las reglas
 * en el modelo `Connection` con type='WORKFLOWS' (un registro por negocio),
 * reutilizando el campo `config Json?` como `{ rules: WorkflowRule[] }`. Mismo
 * patrón que los Permisos del equipo (TEAM_PERMISSIONS), el Ciclo de vida
 * (CRM_LIFECYCLE) y la Base de conocimiento (FAQ_KB): transacción + SELECT ...
 * FOR UPDATE al escribir para no pisar guardados concurrentes (lost-update).
 */
import { randomUUID } from 'crypto';
import { prisma } from '../../lib/prisma';
import { executeAction, type ActionResult, type ExecMode } from '../actions/executor';

const WORKFLOWS_CONNECTION_TYPE = 'WORKFLOWS';
const WORKFLOWS_CONNECTION_NAME = 'Automatizaciones';

/** Tope de reglas por negocio (evita un JSON gigante). */
export const MAX_WORKFLOW_RULES = 100;
/** Topes de longitud por campo de texto libre. */
export const MAX_NAME_LEN = 120;
export const MAX_CONDITION_LEN = 500;

/** Un ítem de catálogo (trigger o acción) para pintar los dropdowns en la UI. */
export interface CatalogItem {
  key: string;
  label: string;
  description: string;
}

/**
 * Catálogo de triggers (eventos que disparan una regla). El orden es el que se
 * muestra en la UI. Cada clave se corresponde con un evento que el pipeline
 * emitirá cuando se cablee la ejecución real.
 */
export const TRIGGER_CATALOG: CatalogItem[] = [
  { key: 'mensaje_entrante', label: 'Mensaje entrante', description: 'Llega un mensaje de un cliente por cualquier canal' },
  { key: 'nueva_reserva', label: 'Nueva reserva', description: 'Un cliente agenda un turno' },
  { key: 'lead_nuevo', label: 'Lead nuevo', description: 'Se registra un contacto/lead nuevo' },
  { key: 'pago_recibido', label: 'Pago recibido', description: 'Se confirma un cobro o pago' },
];

/**
 * Catálogo de acciones (qué hace la regla cuando matchea). El orden es el que se
 * muestra en la UI.
 */
export const ACTION_CATALOG: CatalogItem[] = [
  { key: 'asignar_agente', label: 'Asignar agente', description: 'Deriva la conversación a un agente del equipo' },
  { key: 'enviar_whatsapp', label: 'Enviar WhatsApp', description: 'Manda un mensaje automático por WhatsApp' },
  { key: 'mover_lifecycle', label: 'Mover etapa', description: 'Cambia la etapa del cliente en el embudo (CRM)' },
  { key: 'notificar', label: 'Notificar al equipo', description: 'Genera una novedad/aviso para el equipo' },
];

/** Claves válidas de triggers y acciones, para validar entradas. */
export const TRIGGER_KEYS: readonly string[] = TRIGGER_CATALOG.map((t) => t.key);
export const ACTION_KEYS: readonly string[] = ACTION_CATALOG.map((a) => a.key);

const TRIGGER_SET: ReadonlySet<string> = new Set(TRIGGER_KEYS);
const ACTION_SET: ReadonlySet<string> = new Set(ACTION_KEYS);

export type WorkflowTrigger = (typeof TRIGGER_CATALOG)[number]['key'];
export type WorkflowAction = (typeof ACTION_CATALOG)[number]['key'];

/** Una regla de automatización. */
export interface WorkflowRule {
  id: string;
  nombre: string;
  activo: boolean;
  trigger: string;
  /** Condición simple opcional (texto libre, ej: "monto > 1000"). v1 no la evalúa. */
  condicion?: string;
  accion: string;
}

/** Verifica si un trigger está en el catálogo. */
export function isValidTrigger(value: unknown): value is WorkflowTrigger {
  return typeof value === 'string' && TRIGGER_SET.has(value);
}

/** Verifica si una acción está en el catálogo. */
export function isValidAction(value: unknown): value is WorkflowAction {
  return typeof value === 'string' && ACTION_SET.has(value);
}

function clampText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

/**
 * Normaliza y valida una lista entrante de reglas: descarta reglas con trigger o
 * acción fuera del catálogo, recorta longitudes, reusa el id si vino (o genera
 * uno) y aplica el tope de cantidad. Determinístico y defensivo (sirve para
 * datos de la API). Mismo espíritu que `sanitizeFaqItems` / `sanitizeCapabilities`.
 */
export function sanitizeRules(raw: unknown): WorkflowRule[] {
  if (!Array.isArray(raw)) return [];
  const out: WorkflowRule[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (!isValidTrigger(e.trigger)) continue; // trigger fuera del catálogo → se descarta
    if (!isValidAction(e.accion)) continue; // acción fuera del catálogo → se descarta
    const nombre = clampText(e.nombre, MAX_NAME_LEN);
    if (!nombre) continue; // el nombre es obligatorio
    const condicion = clampText(e.condicion, MAX_CONDITION_LEN);
    const id = typeof e.id === 'string' && e.id.trim() ? e.id.trim().slice(0, 64) : randomUUID();
    out.push({
      id,
      nombre,
      activo: e.activo !== false, // por defecto activa
      trigger: e.trigger,
      ...(condicion ? { condicion } : {}),
      accion: e.accion,
    });
    if (out.length >= MAX_WORKFLOW_RULES) break;
  }
  return out;
}

function normalize(config: unknown): WorkflowRule[] {
  const cfg =
    config && typeof config === 'object' && !Array.isArray(config)
      ? (config as Record<string, unknown>)
      : {};
  return sanitizeRules(cfg.rules);
}

/** Devuelve las reglas del negocio (lista vacía si no hay). */
export async function loadWorkflows(businessId: string): Promise<WorkflowRule[]> {
  const conn = await prisma.connection.findFirst({
    where: { businessId, type: WORKFLOWS_CONNECTION_TYPE },
  });
  return normalize(conn?.config);
}

/**
 * Persiste la lista completa de reglas del negocio.
 *
 * Atómico: transacción con `SELECT ... FOR UPDATE` para no pisar un guardado
 * concurrente (lost-update). Crea el registro Connection si no existe. Devuelve
 * la lista ya saneada que quedó persistida. Es la primitiva de escritura sobre
 * la que se apoyan los helpers de CRUD por id.
 */
export async function saveWorkflows(businessId: string, rules: unknown): Promise<WorkflowRule[]> {
  const clean = sanitizeRules(rules);
  return prisma.$transaction(async (tx) => {
    let conn = await tx.connection.findFirst({
      where: { businessId, type: WORKFLOWS_CONNECTION_TYPE },
      select: { id: true },
    });

    if (!conn) {
      conn = await tx.connection.create({
        data: {
          name: WORKFLOWS_CONNECTION_NAME,
          type: WORKFLOWS_CONNECTION_TYPE,
          icon: 'Workflow',
          isActive: true,
          config: { rules: clean } as unknown as object,
          businessId,
        },
        select: { id: true },
      });
    } else {
      await tx.$queryRaw`SELECT id FROM "connections" WHERE id = ${conn.id} FOR UPDATE`;
      await tx.connection.update({
        where: { id: conn.id },
        data: { config: { rules: clean } as unknown as object, isActive: true },
      });
    }
    return clean;
  });
}

/** Datos para crear una regla (el id y los defaults los pone el servicio). */
export interface CreateRuleInput {
  nombre: string;
  trigger: string;
  accion: string;
  condicion?: string;
  activo?: boolean;
}

/** Campos editables de una regla (patch parcial). */
export type UpdateRuleInput = Partial<CreateRuleInput>;

/**
 * Read-modify-write ATÓMICO de la lista de reglas. El `mutator` recibe la lista
 * FRESCA leída DENTRO de la transacción (tras tomar el lock con SELECT ... FOR
 * UPDATE) y devuelve la lista nueva. Así dos escrituras concurrentes al mismo
 * negocio no se pisan (el segundo ve lo que escribió el primero), que es lo que
 * la versión anterior NO garantizaba (leía fuera de la tx). Mismo patrón que
 * `permissions.ts` / `lifecycle.ts`.
 */
async function mutateRules(
  businessId: string,
  mutator: (current: WorkflowRule[]) => WorkflowRule[],
): Promise<WorkflowRule[]> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.connection.findFirst({
      where: { businessId, type: WORKFLOWS_CONNECTION_TYPE },
      select: { id: true },
    });

    if (!existing) {
      const clean = sanitizeRules(mutator([]));
      await tx.connection.create({
        data: {
          name: WORKFLOWS_CONNECTION_NAME,
          type: WORKFLOWS_CONNECTION_TYPE,
          icon: 'Workflow',
          isActive: true,
          config: { rules: clean } as unknown as object,
          businessId,
        },
      });
      return clean;
    }

    await tx.$queryRaw`SELECT id FROM "connections" WHERE id = ${existing.id} FOR UPDATE`;
    const fresh = await tx.connection.findUnique({ where: { id: existing.id }, select: { config: true } });
    const current = normalize(fresh?.config);
    const clean = sanitizeRules(mutator(current));
    await tx.connection.update({
      where: { id: existing.id },
      data: { config: { rules: clean } as unknown as object, isActive: true },
    });
    return clean;
  });
}

/**
 * Crea una regla nueva. El merge (append + tope) corre DENTRO de la transacción
 * sobre la lista fresca, así no pisa creaciones concurrentes. Devuelve la regla
 * creada, o null si los datos no pasan el saneo o se alcanzó el tope.
 */
export async function createWorkflow(
  businessId: string,
  input: CreateRuleInput,
): Promise<WorkflowRule | null> {
  const id = randomUUID();
  // Validamos la regla candidata aislada antes de tocar la base.
  const [sane] = sanitizeRules([{ ...input, id }]);
  if (!sane) return null;

  let created = false;
  const saved = await mutateRules(businessId, (current) => {
    if (current.length >= MAX_WORKFLOW_RULES) return current; // tope: sin cambios
    created = true;
    return [...current, sane];
  });
  if (!created) return null;
  return saved.find((r) => r.id === id) ?? null;
}

/**
 * Edita una regla por id (incluye activar/desactivar vía `activo`). El merge
 * corre DENTRO de la transacción sobre la lista fresca. Devuelve la regla
 * resultante, o null si no existe.
 */
export async function updateWorkflow(
  businessId: string,
  id: string,
  patch: UpdateRuleInput,
): Promise<WorkflowRule | null> {
  let existed = false;
  const saved = await mutateRules(businessId, (current) => {
    const idx = current.findIndex((r) => r.id === id);
    if (idx === -1) return current;
    const [merged] = sanitizeRules([{ ...current[idx], ...patch, id }]);
    if (!merged) return current;
    existed = true;
    const next = [...current];
    next[idx] = merged;
    return next;
  });
  if (!existed) return null;
  return saved.find((r) => r.id === id) ?? null;
}

/**
 * Borra una regla por id. El filtrado corre DENTRO de la transacción sobre la
 * lista fresca. Devuelve true si existía y se borró, false si no existía.
 */
export async function deleteWorkflow(businessId: string, id: string): Promise<boolean> {
  let removed = false;
  await mutateRules(businessId, (current) => {
    const next = current.filter((r) => r.id !== id);
    if (next.length !== current.length) removed = true;
    return next;
  });
  return removed;
}

/** Evento que podría disparar reglas (lo emitirá el pipeline cuando se cablee). */
export interface WorkflowEvent {
  trigger: string;
  /** Datos del evento (ej: clientId, monto, canal). v1 no los usa para filtrar. */
  payload?: Record<string, unknown>;
}

/**
 * Selecciona las reglas ACTIVAS cuyo trigger matchea el evento.
 *
 * ⚠️ v1: NO ejecuta efectos. Solo devuelve las reglas candidatas (interfaz lista
 * para cablear). La evaluación de la `condicion` queda como stub: por ahora toda
 * regla activa del trigger matchea. Cuando se cablee la ejecución real, acá se
 * evaluará la condición contra `event.payload` y se despacharán las acciones.
 *
 * Firma estable a propósito: el pipeline la llamará con (businessId, event) y
 * recibirá las reglas a ejecutar, sin tener que conocer la persistencia.
 */
export async function evaluateWorkflows(
  businessId: string,
  event: WorkflowEvent,
): Promise<WorkflowRule[]> {
  if (!isValidTrigger(event.trigger)) return [];
  const rules = await loadWorkflows(businessId);
  return rules.filter((r) => r.activo && r.trigger === event.trigger);
  // Nota: la evaluación de `condicion` sigue como stub (toda regla activa del
  // trigger matchea). `runWorkflows` es quien EJECUTA las acciones de las reglas.
}

/** Resultado de correr las reglas de un evento: la regla + lo que hizo su acción. */
export interface WorkflowRunResult {
  ruleId: string;
  nombre: string;
  accion: string;
  result: ActionResult;
}

/**
 * EJECUTA las reglas que matchean un evento: selecciona (evaluateWorkflows) y,
 * por cada regla, despacha su `accion` al executor compartido con el
 * `event.payload` como parámetros.
 *
 * `mode` controla las acciones externas (ver executor): 'dry_run' (por defecto)
 * las simula; 'live' las ejecuta de verdad. Las acciones internas (mover etapa,
 * notificar) se ejecutan en ambos modos. Secuencial a propósito: evita ráfagas
 * contra servicios externos y mantiene un orden determinístico de efectos.
 *
 * Es el cierre del cableado de ejecución: el pipeline de eventos (cuando emita
 * triggers reales) llama a esto; hoy se dispara también desde la ruta de prueba
 * `POST /api/workflows/run`.
 */
export async function runWorkflows(
  businessId: string,
  event: WorkflowEvent,
  mode: ExecMode = 'dry_run',
): Promise<{ matched: number; results: WorkflowRunResult[] }> {
  const rules = await evaluateWorkflows(businessId, event);
  const results: WorkflowRunResult[] = [];
  for (const rule of rules) {
    const result = await executeAction({
      businessId,
      action: rule.accion,
      params: event.payload ?? {},
      mode,
    });
    results.push({ ruleId: rule.id, nombre: rule.nombre, accion: rule.accion, result });
  }
  return { matched: rules.length, results };
}
