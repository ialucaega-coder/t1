/**
 * Executor de ACCIONES compartido (Workflows + orquestador Mr Go).
 *
 * Tanto una regla de automatización ("cuando pasa X, hacé Z") como una decisión
 * del orquestador Mr Go ("delegá en Ventas y generá un link de pago") terminan
 * necesitando EJECUTAR una acción concreta. En vez de duplicar ese despacho en
 * dos lugares, ambos llaman a este executor único, scoped por `businessId`.
 *
 * Mapea cada clave de acción (de WORKFLOWS `ACTION_CATALOG` y de Mr Go
 * `TOOL_CATALOG`) a los SERVICIOS que ya existen — NO reinventa la lógica ni
 * toca el schema (congelado). Llama a los servicios in-process (no HTTP): más
 * rápido y sin re-autenticar.
 *
 * Seguridad / alcance de esta primera etapa de ejecución:
 *  - `interno`: efectos reversibles, sin salida al exterior ni dinero
 *    (mover etapa de CRM, notificar al equipo in-app). Se EJECUTAN de verdad.
 *  - `externo`: efectos salientes (enviar WhatsApp). Cableados pero GATED tras
 *    `mode: 'live'`; en `dry_run` (por defecto) devuelven `simulado` sin enviar.
 *    Así el pipeline automático no manda mensajes reales salvo que se pida
 *    explícitamente la ejecución en vivo.
 *  - Acciones pesadas/irreversibles (crear reserva, link de pago, lanzar
 *    campaña, crear cliente, asignar agente) quedan RECONOCIDAS pero
 *    `no_soportado`: la interfaz está completa y se cablean una por una, sin
 *    disparar dinero/reservas a ciegas desde un loop.
 *
 * Contrato: `executeAction` NUNCA lanza; siempre devuelve un `ActionResult`
 * estructurado (los errores se capturan y se reportan con `status: 'error'`).
 */
import { prisma } from '../../lib/prisma';
import { createNotification } from '../notifications';
import * as whatsapp from '../whatsapp/client';
import { setClientStage, isLifecycleStage } from '../clients/lifecycle';

/** Naturaleza de la acción: interna (reversible) o externa (saliente). */
export type ActionKind = 'interno' | 'externo';

/**
 * Modo de ejecución:
 *  - `dry_run` (por defecto): las acciones externas se SIMULAN (no envían nada).
 *  - `live`: las acciones externas se ejecutan de verdad.
 * Las acciones internas se ejecutan igual en ambos modos (son reversibles).
 */
export type ExecMode = 'dry_run' | 'live';

/** Resultado de intentar una acción. */
export type ActionStatus =
  | 'ejecutado' // se hizo el efecto real
  | 'simulado' // acción externa en dry_run: no se hizo, se describe qué haría
  | 'no_soportado' // acción reconocida pero sin cableado de ejecución todavía
  | 'omitido' // precondición no cumplida (ej: cliente inexistente, sin teléfono)
  | 'error'; // el servicio lanzó

export interface ActionContext {
  businessId: string;
  /** Parámetros de la acción (de la decisión del LLM o del payload del evento). */
  params: Record<string, unknown>;
  mode: ExecMode;
}

export interface ActionResult {
  action: string;
  kind: ActionKind;
  ok: boolean;
  status: ActionStatus;
  detail: string;
  data?: Record<string, unknown>;
}

/** Lo que devuelve un handler (sin repetir `action`/`kind`, que pone el executor). */
type HandlerOutcome = Omit<ActionResult, 'action' | 'kind'>;

interface ActionHandler {
  kind: ActionKind;
  run: (ctx: ActionContext) => Promise<HandlerOutcome>;
}

// ─── Helpers de parámetros ──────────────────────────────────────────────

/** Lee el primer alias presente de `params` como string no vacío. */
function str(params: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = params[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

/** Enmascara un teléfono para logs/respuestas: deja solo los últimos 4 dígitos. */
function maskPhone(phone: string): string {
  const tail = phone.replace(/\D/g, '').slice(-4);
  return tail ? `••••${tail}` : '••••';
}

/**
 * Describe un error SIN filtrar PII: los SDKs externos suelen meter teléfono/
 * email en `message`, así que solo exponemos nombre/código (mismo criterio que
 * services/notifications.ts y routes/campaigns.ts).
 */
function describeError(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { code?: string | number; status?: number; name?: string };
    const parts: string[] = [];
    if (e.name) parts.push(e.name);
    if (e.code !== undefined) parts.push(`code ${e.code}`);
    if (e.status !== undefined) parts.push(`status ${e.status}`);
    if (parts.length) return parts.join(' ');
  }
  return 'error desconocido';
}

/** Resuelve el número de WhatsApp dedicado del negocio (remitente saliente). */
async function resolveBusinessSender(businessId: string): Promise<string | undefined> {
  try {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { whatsappNumber: true },
    });
    return business?.whatsappNumber || undefined;
  } catch {
    return undefined;
  }
}

// ─── Handlers ────────────────────────────────────────────────────────────

/**
 * Mueve la etapa de CRM de un cliente (NEW/HOT/PAYMENT/CUSTOMER). Interno y
 * reversible. Verifica que el cliente pertenezca al negocio (aislamiento
 * multi-tenant) antes de tocar nada.
 */
const moverLifecycle: ActionHandler = {
  kind: 'interno',
  run: async ({ businessId, params }) => {
    const clientId = str(params, 'clientId', 'cliente', 'userId');
    const stage = str(params, 'stage', 'etapa');
    if (!clientId) return { ok: false, status: 'omitido', detail: 'falta clientId' };
    if (!isLifecycleStage(stage)) {
      return { ok: false, status: 'omitido', detail: `etapa inválida: ${stage ?? '(vacía)'}` };
    }

    // Scope multi-tenant: el cliente tiene que ser de ESTE negocio.
    const client = await prisma.user.findFirst({
      where: { id: clientId, businessId },
      select: { id: true },
    });
    if (!client) return { ok: false, status: 'omitido', detail: 'cliente no encontrado en el negocio' };

    const efectiva = await setClientStage(businessId, clientId, stage);
    return { ok: true, status: 'ejecutado', detail: `cliente movido a ${efectiva}`, data: { clientId, stage: efectiva } };
  },
};

/**
 * Notifica al equipo (admins del negocio) con un aviso in-app (PUSH). Interno:
 * no sale al exterior. Mismo patrón que `notifications.sendBookingCreated`.
 */
const notificar: ActionHandler = {
  kind: 'interno',
  run: async ({ businessId, params }) => {
    const title = str(params, 'title', 'titulo') ?? 'Automatización';
    const body = str(params, 'body', 'message', 'mensaje', 'texto') ?? 'Se activó una automatización.';

    const admins = await prisma.user.findMany({
      where: { businessId, role: 'ADMIN' },
      select: { id: true },
    });
    if (admins.length === 0) return { ok: false, status: 'omitido', detail: 'el negocio no tiene admins para notificar' };

    await Promise.all(
      admins.map((a) =>
        createNotification({
          type: 'GENERAL',
          channel: 'PUSH',
          title: title.slice(0, 200),
          body: body.slice(0, 1000),
          userId: a.id,
          businessId,
        }),
      ),
    );
    return { ok: true, status: 'ejecutado', detail: `notificados ${admins.length} admin(s)`, data: { count: admins.length } };
  },
};

/**
 * Envía un WhatsApp al cliente. EXTERNO: solo se envía de verdad en `mode:'live'`;
 * en `dry_run` se simula (describe a quién iría, sin mandar nada). Respeta la
 * config de WhatsApp del negocio y nunca filtra el número completo.
 */
const enviarWhatsapp: ActionHandler = {
  kind: 'externo',
  run: async ({ businessId, params, mode }) => {
    const body = str(params, 'body', 'message', 'mensaje', 'texto');
    if (!body) return { ok: false, status: 'omitido', detail: 'falta el texto del mensaje' };

    // Destinatario: por teléfono directo o resolviendo el cliente del negocio.
    let phone = str(params, 'to', 'phone', 'telefono');
    const clientId = str(params, 'clientId', 'cliente', 'userId');
    if (!phone && clientId) {
      const client = await prisma.user.findFirst({
        where: { id: clientId, businessId },
        select: { phone: true },
      });
      phone = client?.phone ?? undefined;
    }
    if (!phone) return { ok: false, status: 'omitido', detail: 'sin teléfono de destino' };

    if (mode !== 'live') {
      return { ok: true, status: 'simulado', detail: `se enviaría WhatsApp a ${maskPhone(phone)}`, data: { to: maskPhone(phone) } };
    }
    if (!whatsapp.isConfigured()) {
      return { ok: false, status: 'omitido', detail: 'WhatsApp no está configurado en el servidor' };
    }

    const sender = await resolveBusinessSender(businessId);
    await whatsapp.sendMessage(phone, body, sender);
    return { ok: true, status: 'ejecutado', detail: `WhatsApp enviado a ${maskPhone(phone)}`, data: { to: maskPhone(phone) } };
  },
};

/**
 * Acciones reconocidas pero cuya ejecución directa todavía NO se cableó (crear
 * reserva, link de pago, lanzar campaña, crear cliente, asignar agente). Tocan
 * flujos irreversibles o dinero, así que se habilitan una por una con cuidado.
 * Devuelven `no_soportado` para que la interfaz sea completa y honesta.
 */
function placeholder(kind: ActionKind, nombre: string): ActionHandler {
  return {
    kind,
    run: async () => ({ ok: false, status: 'no_soportado', detail: `${nombre}: ejecución directa aún no cableada` }),
  };
}

/**
 * Registro de handlers por clave de acción. Cubre las claves de los dos
 * catálogos (WORKFLOWS ACTION_CATALOG + Mr Go TOOL_CATALOG).
 */
const HANDLERS: Record<string, ActionHandler> = {
  // Workflows (ACTION_CATALOG) + Mr Go (TOOL_CATALOG) comparten estas:
  mover_lifecycle: moverLifecycle,
  enviar_whatsapp: enviarWhatsapp,
  notificar,
  // Reconocidas, sin ejecución directa todavía:
  asignar_agente: placeholder('interno', 'Asignar agente'),
  crear_reserva: placeholder('externo', 'Crear reserva'),
  generar_link_pago: placeholder('externo', 'Generar link de pago'),
  lanzar_campana: placeholder('externo', 'Lanzar campaña'),
  crear_cliente: placeholder('interno', 'Crear cliente'),
};

/** ¿La acción tiene ejecución REAL cableada (no es placeholder)? */
export function isExecutableAction(action: string): boolean {
  return action === 'mover_lifecycle' || action === 'enviar_whatsapp' || action === 'notificar';
}

/**
 * Ejecuta (o simula) una acción. Punto de entrada único para Workflows y Mr Go.
 * NUNCA lanza: cualquier excepción del servicio se captura y se reporta como
 * `status: 'error'` con un detalle sin PII.
 */
export async function executeAction(opts: {
  businessId: string;
  action: string;
  params?: Record<string, unknown>;
  mode?: ExecMode;
}): Promise<ActionResult> {
  const { businessId, action } = opts;
  const params = opts.params ?? {};
  const mode: ExecMode = opts.mode ?? 'dry_run';

  const handler = HANDLERS[action];
  if (!handler) {
    return { action, kind: 'externo', ok: false, status: 'no_soportado', detail: 'acción desconocida' };
  }

  try {
    const outcome = await handler.run({ businessId, params, mode });
    return { action, kind: handler.kind, ...outcome };
  } catch (err) {
    console.error(`[Actions] Error ejecutando "${action}":`, describeError(err));
    return { action, kind: handler.kind, ok: false, status: 'error', detail: describeError(err) };
  }
}
