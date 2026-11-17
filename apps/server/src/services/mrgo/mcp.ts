/**
 * Servidor MCP (Model Context Protocol) de Mr Go — núcleo del protocolo.
 *
 * Expone el catálogo de tools de Mr Go (`TOOL_CATALOG`) como un servidor MCP para
 * que clientes externos (otros agentes, Claude, etc.) puedan listar y ejecutar
 * las acciones del negocio de forma estándar. Implementa JSON-RPC 2.0 sobre HTTP
 * (la ruta `routes/mcp.ts` lo monta en /api/mcp detrás del auth existente).
 *
 * Por qué a mano (y no con @modelcontextprotocol/sdk): el SDK oficial es ESM-only
 * con `exports` map, y este server está en `module: CommonJS` + `moduleResolution:
 * node`, con lo que TS no resuelve sus imports y cambiar esa config rompería todo
 * el código existente. JSON-RPC 2.0 es simple y estable, así que implementamos el
 * subconjunto que necesita un servidor de tools: initialize, tools/list,
 * tools/call, ping. Los efectos reales los hace el EXECUTOR compartido, así que
 * MCP hereda el aislamiento multi-tenant y el gate de modo (simula salvo "en vivo").
 *
 * Seguridad: la ruta va detrás de `requireAuth` → cada request trae el JWT del
 * negocio y todo se ejecuta scopeado por su `businessId`. No hay superficie
 * anónima. Las acciones externas respetan el modo por defecto del negocio salvo
 * que el cliente pase `execute` explícito.
 */
import { TOOL_CATALOG } from './agents';
import { executeAction, type ExecMode } from '../actions/executor';

/** Versión de protocolo MCP que anunciamos (se refleja la del cliente si la manda). */
export const MCP_PROTOCOL_VERSION = '2025-06-18';
export const MCP_SERVER_INFO = { name: 'mr-go', version: '1.0.0' } as const;

// ─── Tipos JSON-RPC 2.0 ─────────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// Códigos de error JSON-RPC estándar.
const ERR_INVALID_REQUEST = -32600;
const ERR_METHOD_NOT_FOUND = -32601;
const ERR_INVALID_PARAMS = -32602;
const ERR_INTERNAL = -32603;

function ok(id: JsonRpcRequest['id'], result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, result };
}
function fail(id: JsonRpcRequest['id'], code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

/** Definiciones de tools en formato MCP (name + description + inputSchema JSON). */
export function mcpToolDefs() {
  return TOOL_CATALOG.map((t) => ({
    name: t.key,
    description: `${t.descripcion}.`,
    inputSchema: {
      type: 'object',
      properties: {
        params: {
          type: 'object',
          description: 'Parámetros de la acción (ej: clientId, monto, stage, campaignId, etc.)',
          additionalProperties: true,
        },
        execute: {
          type: 'boolean',
          description: 'true = ejecutar en vivo (acciones externas reales); omitido = modo por defecto del negocio (normalmente simula).',
        },
      },
    },
  }));
}

/**
 * Resuelve el modo de ejecución para una llamada MCP: `execute` explícito manda
 * (true→live, false→dry_run); si no viene, usa el modo por defecto del negocio.
 */
export function resolveMcpMode(execute: unknown, defaultMode: ExecMode): ExecMode {
  if (execute === true) return 'live';
  if (execute === false) return 'dry_run';
  return defaultMode;
}

/** ¿Es un método de notificación (sin respuesta)? */
export function isNotification(msg: JsonRpcRequest): boolean {
  // Las notificaciones JSON-RPC no llevan `id`. MCP usa notifications/* (ej:
  // notifications/initialized) que no esperan respuesta.
  return msg.id === undefined || msg.method.startsWith('notifications/');
}

/**
 * Procesa UN mensaje JSON-RPC MCP y devuelve la respuesta (o null si es una
 * notificación, que no lleva respuesta). Nunca lanza: los errores se devuelven
 * como error JSON-RPC. `businessId` scopea todo; `defaultMode` es el modo del
 * negocio para las acciones externas cuando el cliente no pide `execute`.
 */
export async function handleMcpMessage(
  businessId: string,
  msg: JsonRpcRequest,
  defaultMode: ExecMode,
): Promise<JsonRpcResponse | null> {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return fail(msg?.id ?? null, ERR_INVALID_REQUEST, 'JSON-RPC inválido');
  }

  // Notificaciones: no se responde (incluido notifications/initialized).
  if (isNotification(msg)) return null;

  switch (msg.method) {
    case 'initialize': {
      const clientVersion = (msg.params?.protocolVersion as string | undefined) || MCP_PROTOCOL_VERSION;
      return ok(msg.id, {
        protocolVersion: clientVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: MCP_SERVER_INFO,
      });
    }

    case 'ping':
      return ok(msg.id, {});

    case 'tools/list':
      return ok(msg.id, { tools: mcpToolDefs() });

    case 'tools/call': {
      const name = msg.params?.name;
      if (typeof name !== 'string') return fail(msg.id, ERR_INVALID_PARAMS, 'Falta el nombre del tool');
      const args = (msg.params?.arguments as Record<string, unknown> | undefined) ?? {};
      const params = (args.params as Record<string, unknown> | undefined) ?? {};
      const mode = resolveMcpMode(args.execute, defaultMode);

      const result = await executeAction({ businessId, action: name, params, mode });
      // MCP: el resultado del tool va como `content`. Marcamos isError si no ok.
      return ok(msg.id, {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        isError: !result.ok,
        structuredContent: result,
      });
    }

    default:
      return fail(msg.id, ERR_METHOD_NOT_FOUND, `Método no soportado: ${msg.method}`);
  }
}

/**
 * Procesa el cuerpo de una request MCP (un mensaje o un batch). Devuelve el
 * array de respuestas (sin las notificaciones). Nunca lanza.
 */
export async function handleMcpBody(
  businessId: string,
  body: unknown,
  defaultMode: ExecMode,
): Promise<JsonRpcResponse[]> {
  const messages = Array.isArray(body) ? body : [body];
  const responses: JsonRpcResponse[] = [];
  for (const m of messages) {
    try {
      const res = await handleMcpMessage(businessId, m as JsonRpcRequest, defaultMode);
      if (res) responses.push(res);
    } catch (err) {
      responses.push(fail((m as JsonRpcRequest)?.id ?? null, ERR_INTERNAL, err instanceof Error ? err.name : 'error interno'));
    }
  }
  return responses;
}
