/**
 * Pruebas del núcleo del servidor MCP de Mr Go (`services/mrgo/mcp.ts`):
 * JSON-RPC 2.0 sobre el catálogo de tools. Cubre initialize, ping, tools/list,
 * tools/call (que delega en el executor compartido), notificaciones sin
 * respuesta, el gate de modo (`resolveMcpMode`) y el manejo de batch/errores.
 * Se mockea `executeAction` para no tocar servicios reales.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../services/actions/executor', () => ({
  executeAction: vi.fn(),
}));

import { executeAction, type ActionResult } from '../../../services/actions/executor';
import {
  mcpToolDefs,
  resolveMcpMode,
  isNotification,
  handleMcpMessage,
  handleMcpBody,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_INFO,
  type JsonRpcRequest,
} from '../../../services/mrgo/mcp';
import { TOOL_CATALOG } from '../../../services/mrgo/agents';

const execMock = executeAction as unknown as ReturnType<typeof vi.fn>;
const BIZ = 'biz_1';

function result(over: Partial<ActionResult> = {}): ActionResult {
  return {
    action: 'crear_cliente',
    kind: 'interno',
    ok: true,
    status: 'ejecutado',
    detail: 'cliente creado',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  execMock.mockResolvedValue(result());
});

describe('mcpToolDefs', () => {
  it('expone todo el TOOL_CATALOG con el esquema MCP', () => {
    const defs = mcpToolDefs();
    expect(defs).toHaveLength(TOOL_CATALOG.length);
    const names = defs.map((d) => d.name).sort();
    expect(names).toEqual(TOOL_CATALOG.map((t) => t.key).sort());
    for (const d of defs) {
      expect(typeof d.description).toBe('string');
      expect(d.inputSchema.type).toBe('object');
      expect(d.inputSchema.properties).toHaveProperty('params');
      expect(d.inputSchema.properties).toHaveProperty('execute');
    }
  });
});

describe('resolveMcpMode', () => {
  it('execute:true → live', () => {
    expect(resolveMcpMode(true, 'dry_run')).toBe('live');
  });
  it('execute:false → dry_run (aunque el negocio esté en vivo)', () => {
    expect(resolveMcpMode(false, 'live')).toBe('dry_run');
  });
  it('sin execute → usa el modo por defecto del negocio', () => {
    expect(resolveMcpMode(undefined, 'live')).toBe('live');
    expect(resolveMcpMode(undefined, 'dry_run')).toBe('dry_run');
  });
  it('valores no booleanos caen al modo por defecto', () => {
    expect(resolveMcpMode('true', 'dry_run')).toBe('dry_run');
    expect(resolveMcpMode(1, 'dry_run')).toBe('dry_run');
    expect(resolveMcpMode(null, 'live')).toBe('live');
  });
});

describe('isNotification', () => {
  it('sin id es notificación', () => {
    expect(isNotification({ jsonrpc: '2.0', method: 'ping' } as JsonRpcRequest)).toBe(true);
  });
  it('notifications/* es notificación aunque traiga id', () => {
    expect(
      isNotification({ jsonrpc: '2.0', id: 1, method: 'notifications/initialized' } as JsonRpcRequest),
    ).toBe(true);
  });
  it('un método normal con id no es notificación', () => {
    expect(isNotification({ jsonrpc: '2.0', id: 1, method: 'tools/list' } as JsonRpcRequest)).toBe(false);
  });
});

describe('handleMcpMessage', () => {
  it('initialize devuelve protocolVersion, capabilities y serverInfo', async () => {
    const res = await handleMcpMessage(BIZ, { jsonrpc: '2.0', id: 1, method: 'initialize' }, 'dry_run');
    expect(res).not.toBeNull();
    const r = res!.result as Record<string, unknown>;
    expect(r.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(r.serverInfo).toEqual(MCP_SERVER_INFO);
    expect(r.capabilities).toHaveProperty('tools');
  });

  it('initialize refleja la versión de protocolo del cliente si la manda', async () => {
    const res = await handleMcpMessage(
      BIZ,
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      'dry_run',
    );
    expect((res!.result as Record<string, unknown>).protocolVersion).toBe('2024-11-05');
  });

  it('ping devuelve resultado vacío', async () => {
    const res = await handleMcpMessage(BIZ, { jsonrpc: '2.0', id: 9, method: 'ping' }, 'dry_run');
    expect(res!.result).toEqual({});
    expect(res!.id).toBe(9);
  });

  it('tools/list devuelve el catálogo completo', async () => {
    const res = await handleMcpMessage(BIZ, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, 'dry_run');
    const tools = (res!.result as { tools: unknown[] }).tools;
    expect(tools).toHaveLength(TOOL_CATALOG.length);
  });

  it('tools/call invoca el executor con businessId, action, params y modo', async () => {
    execMock.mockResolvedValue(result({ action: 'crear_cliente', status: 'ejecutado', ok: true }));
    const res = await handleMcpMessage(
      BIZ,
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'crear_cliente', arguments: { params: { nombre: 'Ana' } } },
      },
      'dry_run',
    );
    expect(execMock).toHaveBeenCalledWith({
      businessId: BIZ,
      action: 'crear_cliente',
      params: { nombre: 'Ana' },
      mode: 'dry_run',
    });
    const r = res!.result as { content: { type: string; text: string }[]; isError: boolean; structuredContent: ActionResult };
    expect(r.isError).toBe(false);
    expect(r.content[0].type).toBe('text');
    expect(JSON.parse(r.content[0].text).status).toBe('ejecutado');
    expect(r.structuredContent.ok).toBe(true);
  });

  it('tools/call con execute:true fuerza modo live', async () => {
    await handleMcpMessage(
      BIZ,
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'enviar_whatsapp', arguments: { params: {}, execute: true } },
      },
      'dry_run',
    );
    expect(execMock).toHaveBeenCalledWith(expect.objectContaining({ mode: 'live' }));
  });

  it('tools/call marca isError cuando el resultado no es ok', async () => {
    execMock.mockResolvedValue(result({ ok: false, status: 'error', detail: 'falló' }));
    const res = await handleMcpMessage(
      BIZ,
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'crear_cliente', arguments: {} } },
      'dry_run',
    );
    expect((res!.result as { isError: boolean }).isError).toBe(true);
  });

  it('tools/call sin nombre de tool devuelve error de params', async () => {
    const res = await handleMcpMessage(
      BIZ,
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { arguments: {} } },
      'dry_run',
    );
    expect(res!.error?.code).toBe(-32602);
    expect(execMock).not.toHaveBeenCalled();
  });

  it('tools/call sin arguments usa params vacío', async () => {
    await handleMcpMessage(
      BIZ,
      { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'crear_cliente' } },
      'dry_run',
    );
    expect(execMock).toHaveBeenCalledWith(expect.objectContaining({ params: {} }));
  });

  it('método desconocido devuelve "method not found"', async () => {
    const res = await handleMcpMessage(BIZ, { jsonrpc: '2.0', id: 8, method: 'foo/bar' }, 'dry_run');
    expect(res!.error?.code).toBe(-32601);
  });

  it('notificación no devuelve respuesta', async () => {
    const res = await handleMcpMessage(
      BIZ,
      { jsonrpc: '2.0', method: 'notifications/initialized' } as JsonRpcRequest,
      'dry_run',
    );
    expect(res).toBeNull();
  });

  it('JSON-RPC inválido (sin jsonrpc 2.0) devuelve invalid request', async () => {
    const res = await handleMcpMessage(BIZ, { method: 'ping', id: 1 } as unknown as JsonRpcRequest, 'dry_run');
    expect(res!.error?.code).toBe(-32600);
  });
});

describe('handleMcpBody', () => {
  it('mensaje único devuelve un array de una respuesta', async () => {
    const out = await handleMcpBody(BIZ, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'dry_run');
    expect(out).toHaveLength(1);
  });

  it('batch devuelve una respuesta por request (omitiendo notificaciones)', async () => {
    const out = await handleMcpBody(
      BIZ,
      [
        { jsonrpc: '2.0', id: 1, method: 'ping' },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      ],
      'dry_run',
    );
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.id)).toEqual([1, 2]);
  });

  it('batch de solo notificaciones no devuelve respuestas', async () => {
    const out = await handleMcpBody(
      BIZ,
      [{ jsonrpc: '2.0', method: 'notifications/initialized' }],
      'dry_run',
    );
    expect(out).toHaveLength(0);
  });

  it('si el executor lanza, se reporta como error interno sin romper el batch', async () => {
    execMock.mockRejectedValueOnce(new Error('boom'));
    const out = await handleMcpBody(
      BIZ,
      [
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'crear_cliente', arguments: {} } },
        { jsonrpc: '2.0', id: 2, method: 'ping' },
      ],
      'dry_run',
    );
    expect(out).toHaveLength(2);
    expect(out[0].error?.code).toBe(-32603);
    expect(out[1].result).toEqual({});
  });
});
