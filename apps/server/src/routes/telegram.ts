import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { createBot, stopBot, setWebhook, handleUpdate, getBotInfo } from '../services/telegram/bot';

// ────────────────────────────────────────────────────────────────
// Rutas de Telegram
//
// POST /api/telegram/webhook/:businessId  — Webhook para updates de Telegram
// POST /api/telegram/connect              — Conectar bot con token
// DELETE /api/telegram/disconnect         — Desconectar bot
// GET /api/telegram/status                — Estado de conexión
// ────────────────────────────────────────────────────────────────

const router = Router();

/**
 * POST /api/telegram/webhook/:businessId
 * Endpoint público que recibe updates de Telegram.
 * No requiere autenticación (Telegram lo llama directamente).
 */
router.post(
  '/webhook/:businessId',
  asyncHandler(async (req, res) => {
    const businessId = String(req.params.businessId);
    const queryToken = req.query.token as string | undefined;

    // Verificar que la conexión existe y está activa
    const connection = await prisma.connection.findFirst({
      where: { businessId, type: 'TELEGRAM', isActive: true },
    });

    if (!connection) {
      // Responder 200 para que Telegram no reintente
      res.status(200).json({ ok: true });
      return;
    }

    // Validar token del webhook contra el botToken almacenado
    const config = connection.config as { botToken?: string } | null;
    if (!queryToken || !config?.botToken || queryToken !== config.botToken) {
      res.status(403).json({ error: 'Invalid webhook token' });
      return;
    }

    try {
      await handleUpdate(businessId, req.body);
    } catch (error) {
      console.error(`Error procesando update de Telegram para ${businessId}:`, error);
    }

    // Siempre responder 200 a Telegram
    res.status(200).json({ ok: true });
  }),
);

/**
 * POST /api/telegram/connect
 * Conecta un bot de Telegram al negocio del usuario autenticado.
 * Body: { botToken: string }
 */
router.post(
  '/connect',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { botToken } = req.body;
    const businessId = req.auth!.businessId;

    if (!botToken || typeof botToken !== 'string') {
      throw new AppError(400, 'Se requiere un token de bot válido');
    }

    // Validar formato básico del token (número:string)
    if (!/^\d+:[A-Za-z0-9_-]+$/.test(botToken)) {
      throw new AppError(400, 'Formato de token inválido. Debe ser como: 123456789:ABCdefGHIjklMNOpqrSTUvwxYZ');
    }

    // Intentar crear el bot (valida el token con Telegram)
    let bot;
    try {
      bot = await createBot(botToken, businessId);
    } catch (error) {
      throw new AppError(400, 'Token de bot inválido. Verificá que el token sea correcto.');
    }

    // Construir URL del webhook
    const baseUrl = process.env.API_PUBLIC_URL || process.env.FRONTEND_URL || 'http://localhost:4000';
    const webhookUrl = `${baseUrl}/api/telegram/webhook/${businessId}?token=${encodeURIComponent(botToken)}`;

    // Configurar webhook en Telegram
    try {
      await setWebhook(businessId, webhookUrl);
    } catch (error) {
      await stopBot(businessId);
      throw new AppError(500, 'No se pudo configurar el webhook. Verificá que la URL sea accesible públicamente.');
    }

    // Guardar o actualizar conexión en la DB
    const existingConnection = await prisma.connection.findFirst({
      where: { businessId, type: 'TELEGRAM' },
    });

    const config = {
      botToken,
      webhookUrl,
      botUsername: bot.botInfo.username,
      botName: bot.botInfo.first_name,
      connectedAt: new Date().toISOString(),
    };

    if (existingConnection) {
      await prisma.connection.update({
        where: { id: existingConnection.id },
        data: {
          config,
          isActive: true,
          name: `Telegram @${bot.botInfo.username}`,
        },
      });
    } else {
      await prisma.connection.create({
        data: {
          name: `Telegram @${bot.botInfo.username}`,
          type: 'TELEGRAM',
          icon: 'Send',
          config,
          isActive: true,
          businessId,
        },
      });
    }

    res.json({
      success: true,
      bot: {
        username: bot.botInfo.username,
        name: bot.botInfo.first_name,
      },
      webhookUrl,
    });
  }),
);

/**
 * DELETE /api/telegram/disconnect
 * Desconecta el bot de Telegram del negocio.
 */
router.delete(
  '/disconnect',
  requireAuth,
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;

    // Detener el bot
    await stopBot(businessId);

    // Desactivar conexión en la DB
    const connection = await prisma.connection.findFirst({
      where: { businessId, type: 'TELEGRAM' },
    });

    if (connection) {
      await prisma.connection.update({
        where: { id: connection.id },
        data: { isActive: false, config: {} },
      });
    }

    res.json({ success: true, message: 'Bot de Telegram desconectado' });
  }),
);

/**
 * GET /api/telegram/status
 * Devuelve el estado de la conexión de Telegram.
 */
router.get(
  '/status',
  requireAuth,
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;

    const connection = await prisma.connection.findFirst({
      where: { businessId, type: 'TELEGRAM' },
    });

    if (!connection || !connection.isActive) {
      res.json({
        connected: false,
        bot: null,
      });
      return;
    }

    const botInfo = getBotInfo(businessId);
    const config = connection.config as { botUsername?: string; botName?: string; connectedAt?: string } | null;

    res.json({
      connected: true,
      bot: {
        username: botInfo?.username || config?.botUsername || null,
        name: botInfo?.first_name || config?.botName || null,
        connectedAt: config?.connectedAt || null,
      },
    });
  }),
);

export { router as telegramRouter };
