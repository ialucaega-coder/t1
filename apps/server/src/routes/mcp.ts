/**
 * Endpoint MCP (Model Context Protocol) de Mr Go.
 *
 * JSON-RPC 2.0 sobre HTTP en POST /api/mcp, detrás del auth existente: cada
 * request trae el JWT del negocio y todo se ejecuta scopeado por su businessId
 * (multi-tenant, sin superficie anónima). El núcleo del protocolo vive en
 * `services/mrgo/mcp.ts`; acá solo resolvemos el modo por defecto del negocio y
 * delegamos.
 *
 * Un cliente MCP se conecta configurando este URL + el header Authorization:
 * Bearer <jwt>. Soporta initialize, tools/list, tools/call y ping. Las acciones
 * externas (enviar WhatsApp, link de pago, etc.) se SIMULAN salvo que el negocio
 * tenga automatizaciones en vivo o el cliente pase `execute: true` en el tool.
 *
 * NOTA DE MONTAJE (en apps/server/src/index.ts):
 *   import { mcpRouter } from './routes/mcp';
 *   app.use('/api/mcp', mcpRouter);
 */
import { Router } from 'express';
import { requireAuth, requireStaff } from '../middleware/auth';
import { tenantRateLimit } from '../middleware/tenantRateLimit';
import { asyncHandler } from '../middleware/errorHandler';
import { getAutomationMode } from '../services/workflows/settings';
import { handleMcpBody } from '../services/mrgo/mcp';
import type { ExecMode } from '../services/actions/executor';

const router = Router();

/** Tope de mensajes por request (batch JSON-RPC): sin esto un solo POST disparaba N acciones. */
export const MCP_MAX_BATCH = 20;

router.post(
  '/',
  requireAuth,
  requireStaff,
  tenantRateLimit({ name: 'mcp', max: 60 }),
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;

    if (Array.isArray(req.body) && req.body.length > MCP_MAX_BATCH) {
      res.status(400).json({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: `El batch supera el máximo de ${MCP_MAX_BATCH} mensajes` },
      });
      return;
    }

    // Modo por defecto para acciones externas: el del negocio (dry_run salvo que
    // tenga automatizaciones en vivo). Fail-safe a dry_run si no se puede leer.
    let defaultMode: ExecMode = 'dry_run';
    try {
      defaultMode = await getAutomationMode(businessId);
    } catch {
      defaultMode = 'dry_run';
    }

    // Ejecutar acciones EN VIVO (`execute:true`) es solo de ADMIN: staff sin ese rol queda siempre en simulación.
    const allowLive = req.auth!.role === 'ADMIN';
    const responses = await handleMcpBody(businessId, req.body, defaultMode, allowLive);

    // Si el cuerpo era solo notificaciones, no hay respuesta (202).
    if (responses.length === 0) {
      res.status(202).end();
      return;
    }
    // Batch → array; mensaje único → objeto.
    res.json(Array.isArray(req.body) ? responses : responses[0]);
  }),
);

export const mcpRouter = router;
