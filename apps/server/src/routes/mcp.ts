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
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { getAutomationMode } from '../services/workflows/settings';
import { handleMcpBody } from '../services/mrgo/mcp';
import type { ExecMode } from '../services/actions/executor';

const router = Router();

router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;

    // Modo por defecto para acciones externas: el del negocio (dry_run salvo que
    // tenga automatizaciones en vivo). Fail-safe a dry_run si no se puede leer.
    let defaultMode: ExecMode = 'dry_run';
    try {
      defaultMode = await getAutomationMode(businessId);
    } catch {
      defaultMode = 'dry_run';
    }

    const responses = await handleMcpBody(businessId, req.body, defaultMode);

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
