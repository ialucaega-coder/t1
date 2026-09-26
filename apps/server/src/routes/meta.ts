import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { prisma } from '../lib/prisma';
import { processMessage, getActiveSuperpowers, type ChatChannel } from '../services/chatbot';
import {
  isConfigured,
  validateSignature,
  parseMetaEvents,
  resolveBusinessByRecipient,
  sendMessage,
  connectionTypeFor,
  verifyTokenOwnership,
  isRecipientClaimedByAnother,
  type MetaPlatform,
} from '../services/meta/client';
import { requireAuth } from '../middleware/auth';

// ────────────────────────────────────────────────────────────────
// Rutas de Meta (Instagram Direct + Facebook Messenger).
//
// GET  /api/meta/webhook       — verificación del webhook (Meta lo llama una vez)
// POST /api/meta/webhook       — eventos entrantes (mensajes de clientes)
// POST /api/meta/connect       — conectar una página / cuenta de IG (autenticado)
// DELETE /api/meta/disconnect  — desconectar (autenticado)
// GET  /api/meta/status        — estado de conexiones (autenticado)
// ────────────────────────────────────────────────────────────────

const router = Router();

/** Mapea la plataforma interna al canal del chatbot. */
function chatChannelFor(platform: MetaPlatform): ChatChannel {
  return platform === 'instagram' ? 'INSTAGRAM' : 'MESSENGER';
}

/**
 * GET /api/meta/webhook
 * Verificación del webhook: Meta manda hub.mode=subscribe + hub.verify_token y
 * espera que devolvamos el hub.challenge en texto plano si el token coincide.
 */
router.get('/webhook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const expected = process.env.META_VERIFY_TOKEN;
  if (mode === 'subscribe' && expected && token === expected) {
    res.status(200).send(String(challenge ?? ''));
    return;
  }
  res.sendStatus(403);
});

/**
 * POST /api/meta/webhook
 * Recibe los eventos de mensajería. Responde 200 siempre (Meta reintenta si no).
 * En producción valida la firma X-Hub-Signature-256 contra el cuerpo crudo.
 */
router.post(
  '/webhook',
  asyncHandler(async (req: Request, res: Response) => {
    // Firma segura por defecto: validamos siempre salvo opt-in explícito para
    // desarrollo local (SKIP_WEBHOOK_SIGNATURE_VALIDATION=true). No dependemos de
    // que NODE_ENV esté seteado a 'production' en cada despliegue.
    if (process.env.SKIP_WEBHOOK_SIGNATURE_VALIDATION !== 'true') {
      const signature = req.headers['x-hub-signature-256'];
      const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
      if (!validateSignature(rawBody, signature)) {
        res.sendStatus(403);
        return;
      }
    }

    // Respondemos 200 cuanto antes y procesamos; si algo falla, se loguea.
    res.status(200).send('EVENT_RECEIVED');

    try {
      const messages = parseMetaEvents(req.body || {});
      for (const msg of messages) {
        const target = await resolveBusinessByRecipient(msg.platform, msg.recipientId);
        if (!target) continue;

        const { businessId, botId, pageAccessToken } = target;

        // Visión ("Oído y vista"): las URLs de imagen de Meta son públicas y
        // temporales, así que Anthropic puede descargarlas por URL directa (a
        // diferencia de Twilio). Solo las pasamos si el superpoder está activo.
        let images = msg.images;
        if (images.length) {
          const active = await getActiveSuperpowers(businessId);
          images = active.has('Oído y vista') ? images : [];
        }

        const existing = await prisma.conversation.findFirst({
          where: {
            businessId,
            botId,
            contactPhone: msg.senderId,
            status: 'OPEN',
          },
          orderBy: { updatedAt: 'desc' },
        });

        // El placeholder se calcula sobre las imágenes ORIGINALES (antes del gate),
        // para que un mensaje de solo-imagen siempre reciba respuesta aunque el
        // superpoder de visión esté apagado (consistente con el canal de WhatsApp).
        const body = msg.text || (msg.images.length ? '(imagen adjunta)' : '');
        if (!body) continue;

        try {
          const result = await processMessage(businessId, body, chatChannelFor(msg.platform), {
            conversationId: existing?.id,
            botId,
            // Guardamos el id de Meta del usuario en contactPhone para poder
            // reabrir la misma conversación y responderle.
            contactPhone: msg.senderId,
            ...(images.length ? { images } : {}),
          });

          await sendMessage(pageAccessToken, msg.senderId, result.text);
        } catch (error) {
          console.error('Error procesando mensaje de Meta:', error);
        }
      }
    } catch (error) {
      console.error('Meta webhook error:', error);
    }
  }),
);

const connectSchema = z.object({
  platform: z.enum(['instagram', 'messenger']),
  pageAccessToken: z.string().min(1),
  pageId: z.string().min(1).optional(),
  igId: z.string().min(1).optional(),
  pageName: z.string().max(120).optional(),
}).refine((d) => Boolean(d.pageId || d.igId), {
  message: 'Se requiere pageId (Messenger) o igId (Instagram)',
});

/**
 * POST /api/meta/connect
 * Conecta una página de Facebook (Messenger) o cuenta de Instagram al negocio.
 * Crea/actualiza la Connection y asegura un Bot activo para el canal.
 */
router.post(
  '/connect',
  requireAuth,
  validate(connectSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const businessId = req.auth!.businessId;
    const { platform, pageAccessToken, pageId, igId, pageName } = req.body as z.infer<typeof connectSchema>;

    const type = connectionTypeFor(platform as MetaPlatform);
    const botChannel = platform === 'instagram' ? 'INSTAGRAM' : 'WEBCHAT';
    const label = platform === 'instagram' ? 'Instagram' : 'Messenger';
    const identityId = (igId ?? pageId) as string;

    // Anti-hijack cross-tenant: el token debe controlar realmente la identidad
    // declarada, y ningún otro negocio puede tenerla ya reclamada.
    const owns = await verifyTokenOwnership(pageAccessToken, identityId);
    if (!owns) {
      throw new AppError(400, 'El token no controla la página/cuenta indicada. Verificá el Page Access Token y el ID.');
    }
    const claimed = await isRecipientClaimedByAnother(platform as MetaPlatform, identityId, businessId);
    if (claimed) {
      throw new AppError(409, 'Esa página/cuenta ya está conectada a otro negocio.');
    }

    // Aseguramos un bot activo para este canal (reutiliza el existente si lo hay).
    let bot = await prisma.bot.findFirst({
      where: { businessId, channel: botChannel as never, name: `${label} bot` },
    });
    if (!bot) {
      bot = await prisma.bot.create({
        data: {
          name: `${label} bot`,
          channel: botChannel as never,
          status: 'ACTIVE',
          businessId,
        },
      });
    } else if (bot.status !== 'ACTIVE') {
      bot = await prisma.bot.update({ where: { id: bot.id }, data: { status: 'ACTIVE' } });
    }

    const config = {
      pageAccessToken,
      ...(pageId ? { pageId } : {}),
      ...(igId ? { igId } : {}),
      pageName: pageName || label,
      botId: bot.id,
      connectedAt: new Date().toISOString(),
    };

    const existing = await prisma.connection.findFirst({ where: { businessId, type } });
    if (existing) {
      await prisma.connection.update({
        where: { id: existing.id },
        data: { config, isActive: true, name: `${label} — ${pageName || (igId ?? pageId)}` },
      });
    } else {
      await prisma.connection.create({
        data: {
          name: `${label} — ${pageName || (igId ?? pageId)}`,
          type,
          icon: platform === 'instagram' ? 'Instagram' : 'MessageCircle',
          config,
          isActive: true,
          businessId,
        },
      });
    }

    res.json({ success: true, platform, botId: bot.id });
  }),
);

/**
 * DELETE /api/meta/disconnect?platform=instagram|messenger
 * Desactiva la conexión de la plataforma indicada.
 */
router.delete(
  '/disconnect',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const businessId = req.auth!.businessId;
    const platform = req.query.platform;
    if (platform !== 'instagram' && platform !== 'messenger') {
      throw new AppError(400, 'Parámetro platform inválido (instagram | messenger)');
    }
    const type = connectionTypeFor(platform);

    const connection = await prisma.connection.findFirst({ where: { businessId, type } });
    if (connection) {
      await prisma.connection.update({
        where: { id: connection.id },
        data: { isActive: false, config: {} },
      });
    }

    res.json({ success: true, message: `${platform} desconectado` });
  }),
);

/**
 * GET /api/meta/status
 * Estado de las conexiones de Instagram y Messenger del negocio.
 */
router.get(
  '/status',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const businessId = req.auth!.businessId;

    const connections = await prisma.connection.findMany({
      where: { businessId, type: { in: ['INSTAGRAM', 'MESSENGER'] } },
      select: { type: true, isActive: true, config: true, name: true },
    });

    const byType = (t: string) => connections.find((c) => c.type === t);
    const describe = (t: string) => {
      const conn = byType(t);
      if (!conn || !conn.isActive) return { connected: false };
      const cfg = (conn.config as Record<string, unknown> | null) || {};
      return {
        connected: true,
        name: conn.name,
        pageId: cfg.pageId ?? null,
        igId: cfg.igId ?? null,
        connectedAt: cfg.connectedAt ?? null,
      };
    };

    res.json({
      configured: isConfigured(),
      instagram: describe('INSTAGRAM'),
      messenger: describe('MESSENGER'),
    });
  }),
);

export { router as metaRouter };
