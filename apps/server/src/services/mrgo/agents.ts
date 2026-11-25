/**
 * Mr Go — catálogo de ROLES de agente + config por negocio.
 *
 * Mr Go es el avatar/orquestador "CEO" (lila) que se para ENCIMA de Local B y
 * delega en 14 agentes-rol (uno por giro/área: Marketing, Ventas, Finanzas,
 * Reservas, Cobros, Soporte, Inbox, CRM, etc.). Este módulo define el catálogo
 * de roles (para pintar el panel) y guarda, por negocio, qué agentes están
 * activos y con qué motor de IA opcional corre cada uno.
 *
 * Alcance v1: catálogo + persistencia de la config. La DECISIÓN de routing la
 * arma `orchestrator.ts`; la EJECUCIÓN real de los tools NO se cablea todavía
 * (mismo criterio que workflows: interfaz lista, ejecución después).
 *
 * Persistencia: el schema de Prisma está congelado, así que guardamos la config
 * en el modelo `Connection` con type='MRGO_AGENTS' (un registro por negocio),
 * reutilizando el campo `config Json?` como `{ agents: AgentConfig[] }`. Mismo
 * patrón que Workflows (WORKFLOWS) y Permisos del equipo (TEAM_PERMISSIONS):
 * transacción + SELECT ... FOR UPDATE al escribir para no pisar guardados
 * concurrentes (lost-update).
 */
import { prisma } from '../../lib/prisma';
import { lockSingleton } from '../../lib/singletonLock';

const MRGO_CONNECTION_TYPE = 'MRGO_AGENTS';
const MRGO_CONNECTION_NAME = 'Agentes de Mr Go';

/** Topes de longitud para los campos de texto libre de la config del motor. */
export const MAX_PROVIDER_LEN = 60;
export const MAX_MODEL_LEN = 120;
/** Tope del nombre personalizado del agente (lo que el dueño escribe en el Studio). */
export const MAX_NAME_LEN = 40;

// Catálogos de personalización del avatar (Studio "Tu Mr Go"). Son la MISMA
// verdad que el front (`components/mrgo/types.ts`); el server no puede importar
// del web, así que se declaran acá como sets de validación defensiva. El sobre
// visual (color/emoción/mascota) se guarda por agente y lo pinta la Oficina.
const MRGO_COLOR_KEYS: ReadonlySet<string> = new Set([
  'LILA', 'RED', 'PINK', 'LIGHT_BLUE', 'WHITE', 'ORANGE', 'BROWN',
  'BEIGE', 'TURQUOISE', 'GREEN', 'LIME', 'BLACK', 'BLUE', 'YELLOW',
]);
const MRGO_EMOTIONS: ReadonlySet<string> = new Set([
  'happy', 'working', 'thinking', 'nerd', 'angry', 'sleepy', 'love',
]);
const MRGO_PETS: ReadonlySet<string> = new Set([
  'jinx', 'rayito', 'relojito', 'billetin', 'cerebrito', 'megafonito',
]);
/** Valor de `pet` que representa "sin mascota" (se guarda explícito). */
export const PET_NONE = 'none';

/** Un rol de agente del catálogo (lo que Mr Go puede "activar" y delegar). */
export interface AgentRole {
  key: string;
  nombre: string;
  /** Color de la marca para el avatar/tarjeta en el panel. */
  color: string;
  descripcion: string;
}

/**
 * Catálogo de los 14 roles de agente (los "giros/áreas" sobre los que Mr Go
 * orquesta). El orden es el que se muestra en el panel. `ceo` es el propio
 * Mr Go: el que coordina y al que cae todo lo que no encaja en otro rol.
 */
export const AGENT_CATALOG: AgentRole[] = [
  { key: 'ceo', nombre: 'Mr Go (CEO)', color: '#7C3AED', descripcion: 'Director que coordina y delega; atiende lo estratégico y lo que no encaja en otro rol' },
  { key: 'marketing', nombre: 'Marketing', color: '#EC4899', descripcion: 'Contenidos, redes, posicionamiento y voz de marca' },
  { key: 'ventas', nombre: 'Ventas', color: '#F97316', descripcion: 'Cierre de oportunidades, cotizaciones y seguimiento comercial' },
  { key: 'finanzas', nombre: 'Finanzas', color: '#16A34A', descripcion: 'Caja, facturación, reportes financieros y control de gastos' },
  { key: 'reservas', nombre: 'Turnos y Reservas', color: '#0EA5E9', descripcion: 'Agenda, disponibilidad y gestión de turnos' },
  { key: 'cobros', nombre: 'Cobros', color: '#CA8A04', descripcion: 'Links de pago, recordatorios de deuda y conciliación de cobros' },
  { key: 'soporte', nombre: 'Soporte', color: '#DC2626', descripcion: 'Dudas, reclamos y postventa de clientes' },
  { key: 'inbox', nombre: 'Inbox', color: '#2563EB', descripcion: 'Bandeja unificada de conversaciones por todos los canales' },
  { key: 'crm', nombre: 'CRM', color: '#9333EA', descripcion: 'Ficha de clientes, etapas del embudo y ciclo de vida' },
  { key: 'catalogo', nombre: 'Catálogo', color: '#0D9488', descripcion: 'Servicios, productos y órdenes' },
  { key: 'campanas', nombre: 'Campañas', color: '#DB2777', descripcion: 'Envíos masivos, difusión y automatizaciones de marketing' },
  { key: 'analitica', nombre: 'Análisis', color: '#4F46E5', descripcion: 'Métricas, reportes y lectura de resultados del negocio' },
  { key: 'rrhh', nombre: 'Equipo', color: '#059669', descripcion: 'Miembros del equipo, permisos y coordinación interna' },
  { key: 'operaciones', nombre: 'Operaciones', color: '#64748B', descripcion: 'Logística, tareas internas y seguimiento operativo' },
];

/** Claves válidas de roles, para validar entradas. */
export const AGENT_KEYS: readonly string[] = AGENT_CATALOG.map((a) => a.key);
const AGENT_SET: ReadonlySet<string> = new Set(AGENT_KEYS);

/** El rol por defecto al que cae todo si no hay otro mejor (Mr Go mismo). */
export const DEFAULT_AGENT_KEY = 'ceo';

/** Un tool que un agente podría ejecutar (mapea a un endpoint YA existente). */
export interface AgentTool {
  key: string;
  nombre: string;
  descripcion: string;
  /**
   * Endpoint existente al que mapea (solo referencia/documentación). v1 NO lo
   * ejecuta: el orquestador decide el tool pero el cableado real es posterior.
   */
  endpoint: string;
}

/**
 * Catálogo de TOOLS que Mr Go puede proponer. Son nombres/descripciones + el
 * endpoint existente al que mapean, para que el LLM sepa qué puede delegar.
 * ⚠️ v1: NO se ejecutan (ver orchestrator.ts), solo se devuelven en la decisión.
 */
export const TOOL_CATALOG: AgentTool[] = [
  { key: 'crear_reserva', nombre: 'Crear reserva', descripcion: 'Agenda un turno para un cliente', endpoint: 'POST /api/bookings' },
  { key: 'generar_link_pago', nombre: 'Generar link de pago', descripcion: 'Crea un cobro/link de pago para un cliente', endpoint: 'POST /api/payments/links' },
  { key: 'enviar_whatsapp', nombre: 'Enviar WhatsApp', descripcion: 'Envía un mensaje por WhatsApp al cliente', endpoint: 'POST /api/messages' },
  { key: 'mover_lifecycle', nombre: 'Mover etapa de CRM', descripcion: 'Cambia la etapa del cliente en el embudo', endpoint: 'PATCH /api/clients/:id/lifecycle' },
  { key: 'lanzar_campana', nombre: 'Lanzar campaña', descripcion: 'Dispara una campaña de difusión/marketing', endpoint: 'POST /api/campaigns/:id/send' },
  { key: 'crear_cliente', nombre: 'Crear cliente', descripcion: 'Registra un contacto/lead nuevo en el CRM', endpoint: 'POST /api/clients' },
];

/** Claves válidas de tools, para validar entradas. */
export const TOOL_KEYS: readonly string[] = TOOL_CATALOG.map((t) => t.key);
const TOOL_SET: ReadonlySet<string> = new Set(TOOL_KEYS);

/**
 * Tools permitidos por rol (patrón CrewAI: cada agente tiene su caja de
 * herramientas). El orquestador no deja que un agente proponga un tool fuera de
 * su área (ej: Soporte no genera links de pago). El `ceo` coordina y puede todo.
 * Un rol sin entrada acá no tiene tools propios (solo rutea/responde).
 */
export const ROLE_TOOLS: Record<string, readonly string[]> = {
  ceo: TOOL_KEYS, // el CEO coordina: acceso a todo el catálogo
  ventas: ['generar_link_pago', 'crear_cliente', 'enviar_whatsapp'],
  finanzas: ['generar_link_pago'],
  reservas: ['crear_reserva', 'enviar_whatsapp'],
  cobros: ['generar_link_pago', 'enviar_whatsapp'],
  soporte: ['enviar_whatsapp'],
  inbox: ['enviar_whatsapp'],
  crm: ['mover_lifecycle', 'crear_cliente'],
  marketing: ['lanzar_campana'],
  campanas: ['lanzar_campana', 'enviar_whatsapp'],
  // catalogo, analitica, rrhh, operaciones: sin tools propios (solo responden).
};

/**
 * Tools EFECTIVOS de un agente: por defecto los de su rol (`ROLE_TOOLS`), pero
 * si el negocio definió un override por agente (`config.tools`, editable en el
 * Studio) se devuelve la INTERSECCIÓN con el rol. Invariante de seguridad: el
 * override SOLO puede restringir dentro del rol, nunca ampliar (un tool fuera
 * del rol se ignora). `config` ausente o sin `tools` = rol completo (herencia).
 */
export function effectiveTools(
  agentKey: string,
  config?: Pick<AgentConfig, 'tools'>,
): readonly string[] {
  const roleTools = ROLE_TOOLS[agentKey] ?? [];
  if (!config || !Array.isArray(config.tools)) return roleTools;
  const roleSet = new Set(roleTools);
  return config.tools.filter((t) => roleSet.has(t));
}

/** ¿El agente tiene permitido usar ese tool? Considera el override del negocio
 *  (Studio) si se pasa `config`; sin `config`, usa los tools del rol. */
export function toolAllowedForAgent(
  agentKey: string,
  toolKey: string,
  config?: Pick<AgentConfig, 'tools'>,
): boolean {
  if (!TOOL_SET.has(toolKey)) return false;
  return effectiveTools(agentKey, config).includes(toolKey);
}

/** Verifica si una clave de rol pertenece al catálogo. */
export function isValidAgentKey(value: unknown): value is string {
  return typeof value === 'string' && AGENT_SET.has(value);
}

/** Verifica si una clave de tool pertenece al catálogo. */
export function isValidToolKey(value: unknown): value is string {
  return typeof value === 'string' && TOOL_SET.has(value);
}

/** Config de UN agente del negocio: si está activo + su motor de IA opcional. */
export interface AgentConfig {
  key: string;
  activo: boolean;
  /** Familia de proveedor de IA opcional para este agente (ej: 'anthropic'). */
  llmProvider?: string;
  /** Modelo de IA opcional para este agente (ej: 'claude-3-5-sonnet'). */
  llmModel?: string;
  // ─── Personalización del avatar (Studio "Tu Mr Go") ───────────────────────
  /** Nombre personalizado del agente (máx 40). Si falta, la UI usa el del catálogo. */
  nombre?: string;
  /** Color del cuerpo elegido (familia Mr Go). Si falta, la UI usa el del rol. */
  colorKey?: string;
  /** Expresión/emoción por defecto en reposo. Si falta, la UI decide. */
  emotion?: string;
  /** Mascota elegida: una del catálogo o 'none' (sin mascota). Si falta, la del rol. */
  pet?: string;
  // ─── Gating de tools por agente (editable en el Studio) ────────────────────
  /**
   * Allowlist explícita de tools para este agente. Si falta (undefined), hereda
   * TODOS los tools de su rol (`ROLE_TOOLS`). Si está, son los únicos tools que
   * puede ejecutar (siempre intersectados con el rol: no se puede ampliar). Un
   * array vacío = el agente no ejecuta ninguna acción (solo responde).
   */
  tools?: string[];
}

function clampText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

/**
 * Normaliza el override de tools de un agente. Devuelve `undefined` (= heredar
 * el rol completo) cuando `raw` no es un array o cuando el subconjunto válido
 * iguala al set completo del rol; devuelve un array (posiblemente vacío) cuando
 * de verdad RESTRINGE. Siempre: solo claves del catálogo permitidas por el rol,
 * sin duplicados, en orden canónico. Nunca amplía más allá del rol.
 */
function sanitizeAgentTools(agentKey: string, raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined; // sin override → hereda el rol
  const roleTools = ROLE_TOOLS[agentKey] ?? [];
  const roleSet = new Set(roleTools);
  const seen = new Set<string>();
  for (const t of raw) {
    if (typeof t === 'string' && TOOL_SET.has(t) && roleSet.has(t)) seen.add(t);
  }
  // Si quedó todo el rol (mismo tamaño ⇒ mismo set, por ser subconjunto válido)
  // es herencia: no guardamos override.
  if (seen.size === roleSet.size) return undefined;
  return TOOL_KEYS.filter((k) => seen.has(k)); // orden canónico
}

/**
 * Normaliza y valida una lista entrante de configs de agente: descarta claves
 * fuera del catálogo, deduplica (gana la última), recorta longitudes. El
 * resultado se devuelve en el orden canónico del catálogo. Determinístico y
 * defensivo (datos de API). Mismo espíritu que `sanitizeRules` de workflows.
 */
export function sanitizeAgents(raw: unknown): AgentConfig[] {
  if (!Array.isArray(raw)) return [];
  const byKey = new Map<string, AgentConfig>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (!isValidAgentKey(e.key)) continue; // rol fuera del catálogo → se descarta
    const llmProvider = clampText(e.llmProvider, MAX_PROVIDER_LEN);
    const llmModel = clampText(e.llmModel, MAX_MODEL_LEN);
    // Personalización del avatar: solo valores del catálogo (defensivo).
    const nombre = clampText(e.nombre, MAX_NAME_LEN);
    const colorKey = typeof e.colorKey === 'string' && MRGO_COLOR_KEYS.has(e.colorKey) ? e.colorKey : '';
    const emotion = typeof e.emotion === 'string' && MRGO_EMOTIONS.has(e.emotion) ? e.emotion : '';
    const pet =
      e.pet === PET_NONE ? PET_NONE : typeof e.pet === 'string' && MRGO_PETS.has(e.pet) ? e.pet : '';
    // Gating de tools: solo claves válidas Y permitidas por el rol (no se puede
    // ampliar), deduplicadas y en orden canónico del catálogo. Si el override
    // iguala al set completo del rol se omite (= herencia); así solo se persiste
    // cuando de verdad RESTRINGE. Si `e.tools` no es array → undefined (hereda).
    const tools = sanitizeAgentTools(e.key, e.tools);
    byKey.set(e.key, {
      key: e.key,
      activo: e.activo !== false, // por defecto activo
      ...(llmProvider ? { llmProvider } : {}),
      ...(llmModel ? { llmModel } : {}),
      ...(nombre ? { nombre } : {}),
      ...(colorKey ? { colorKey } : {}),
      ...(emotion ? { emotion } : {}),
      ...(pet ? { pet } : {}),
      ...(tools !== undefined ? { tools } : {}),
    });
  }
  // Orden canónico del catálogo (estable para la UI).
  return AGENT_KEYS.filter((k) => byKey.has(k)).map((k) => byKey.get(k)!);
}

function normalize(config: unknown): AgentConfig[] {
  const cfg =
    config && typeof config === 'object' && !Array.isArray(config)
      ? (config as Record<string, unknown>)
      : {};
  return sanitizeAgents(cfg.agents);
}

/**
 * Fusiona el catálogo completo con la config guardada: todo rol del catálogo
 * aparece, con su `activo` por defecto en true (así Mr Go funciona de entrada,
 * sin configurar nada) salvo que la config guardada diga lo contrario. Devuelve
 * la vista "resuelta" que consume el panel y el orquestador.
 */
export function resolveAgents(saved: AgentConfig[]): AgentConfig[] {
  const byKey = new Map(saved.map((a) => [a.key, a]));
  return AGENT_CATALOG.map((role): AgentConfig => {
    const cfg = byKey.get(role.key);
    return {
      key: role.key,
      activo: cfg ? cfg.activo : true,
      ...(cfg?.llmProvider ? { llmProvider: cfg.llmProvider } : {}),
      ...(cfg?.llmModel ? { llmModel: cfg.llmModel } : {}),
      ...(cfg?.nombre ? { nombre: cfg.nombre } : {}),
      ...(cfg?.colorKey ? { colorKey: cfg.colorKey } : {}),
      ...(cfg?.emotion ? { emotion: cfg.emotion } : {}),
      ...(cfg?.pet ? { pet: cfg.pet } : {}),
      ...(cfg && Array.isArray(cfg.tools) ? { tools: cfg.tools } : {}),
    };
  });
}

/** Devuelve la config resuelta de agentes del negocio (catálogo + guardado). */
export async function loadAgents(businessId: string): Promise<AgentConfig[]> {
  const conn = await prisma.connection.findFirst({
    where: { businessId, type: MRGO_CONNECTION_TYPE },
    orderBy: { id: 'asc' },
  });
  return resolveAgents(normalize(conn?.config));
}

/**
 * Persiste la config de agentes del negocio.
 *
 * Atómico: transacción con `SELECT ... FOR UPDATE` para no pisar un guardado
 * concurrente (lost-update). Crea el registro Connection si no existe. Devuelve
 * la vista resuelta (catálogo + guardado) que quedó vigente. Mismo patrón que
 * `saveWorkflows`.
 */
export async function saveAgents(businessId: string, agents: unknown): Promise<AgentConfig[]> {
  const clean = sanitizeAgents(agents);
  return prisma.$transaction(async (tx) => {
    await lockSingleton(tx, businessId, MRGO_CONNECTION_TYPE);
    let conn = await tx.connection.findFirst({
      where: { businessId, type: MRGO_CONNECTION_TYPE },
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    if (!conn) {
      conn = await tx.connection.create({
        data: {
          name: MRGO_CONNECTION_NAME,
          type: MRGO_CONNECTION_TYPE,
          icon: 'Bot',
          isActive: true,
          config: { agents: clean } as unknown as object,
          businessId,
        },
        select: { id: true },
      });
    } else {
      await tx.$queryRaw`SELECT id FROM "connections" WHERE id = ${conn.id} FOR UPDATE`;
      await tx.connection.update({
        where: { id: conn.id },
        data: { config: { agents: clean } as unknown as object, isActive: true },
      });
    }
    return resolveAgents(clean);
  });
}
