import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { getIO } from '../lib/socket';
import { paginationSchema, toSkipTake } from '../validators/common';
import * as whatsapp from '../services/whatsapp/client';
import { sendGenericNotification } from '../services/email';

const createCampaignSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  channel: z.enum(['whatsapp', 'email', 'sms', 'telegram']).default('whatsapp'),
  scheduledAt: z.string().datetime().optional(),
});

const sendCampaignSchema = z.object({
  message: z.string().max(2000).optional(),
});

const updateCampaignSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  status: z.enum(['draft', 'scheduled', 'sent', 'cancelled']).optional(),
  channel: z.enum(['whatsapp', 'email', 'sms', 'telegram']).optional(),
  scheduledAt: z.string().datetime().optional(),
});

const router = Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const pagination = paginationSchema.parse(req.query);
    const where = { businessId: req.auth!.businessId };
    const [campaigns, total] = await Promise.all([
      prisma.campaign.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...toSkipTake(pagination),
      }),
      prisma.campaign.count({ where }),
    ]);
    res.json({ data: campaigns, total, page: pagination.page, pageSize: pagination.pageSize });
  })
);

router.get(
  '/recipients',
  requireAuth,
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const channel = req.query.channel as string | undefined;

    const bookings = await prisma.booking.findMany({
      where: { businessId },
      select: { clientId: true },
      distinct: ['clientId'],
    });
    const clientIds = bookings.map((b) => b.clientId);

    if (clientIds.length === 0) {
      return res.json({ total: 0, recipients: [] });
    }

    const users = await prisma.user.findMany({
      where: { id: { in: clientIds } },
      select: { id: true, name: true, email: true, phone: true },
      orderBy: { name: 'asc' },
    });

    const recipients = users.filter((u) => {
      if (!channel || channel === 'email') return !!u.email;
      if (channel === 'whatsapp' || channel === 'sms') return !!u.phone;
      return true;
    });

    res.json({ total: recipients.length, recipients });
  })
);

router.post(
  '/',
  requireAuth,
  requireRole('ADMIN'),
  validate(createCampaignSchema),
  asyncHandler(async (req, res) => {
    const { name, description, channel, scheduledAt } = req.body;
    const campaign = await prisma.campaign.create({
      data: {
        name,
        description,
        channel: channel || 'whatsapp',
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        businessId: req.auth!.businessId,
      },
    });
    res.status(201).json(campaign);
  })
);

router.patch(
  '/:id',
  requireAuth,
  requireRole('ADMIN'),
  validate(updateCampaignSchema),
  asyncHandler(async (req, res) => {
    const { name, description, status, channel, scheduledAt } = req.body;
    const upd = await prisma.campaign.updateMany({
      where: { id: String(req.params.id), businessId: req.auth!.businessId },
      data: { name, description, status, channel, scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined },
    });
    if (upd.count === 0) return res.status(404).json({ error: 'Campaign not found' });
    const campaign = await prisma.campaign.findFirst({ where: { id: String(req.params.id), businessId: req.auth!.businessId } });
    res.json(campaign);
  })
);

router.post(
  '/:id/send',
  requireAuth,
  requireRole('ADMIN'),
  validate(sendCampaignSchema),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const businessId = req.auth!.businessId;

    // Claim ATÓMICO: marca la campaña como 'sent' solo si todavía NO lo estaba.
    // Así, ante dos envíos concurrentes (misma campaña), solo uno gana el
    // updateMany y el otro ve count=0 y corta. Antes el check de estado y el
    // update final no eran atómicos (TOCTOU) y permitían doble-envío.
    const claim = await prisma.campaign.updateMany({
      where: { id, businessId, status: { not: 'sent' } },
      data: { status: 'sent' },
    });
    if (claim.count === 0) {
      const exists = await prisma.campaign.findFirst({ where: { id, businessId }, select: { id: true } });
      throw new AppError(exists ? 400 : 404, exists ? 'Campaign already sent' : 'Campaign not found');
    }

    const campaign = await prisma.campaign.findFirst({ where: { id, businessId } });
    if (!campaign) throw new AppError(404, 'Campaign not found'); // defensivo: no debería ocurrir tras el claim

    // Cuerpo a enviar: manda el `message` del request; si no viene, caemos a la
    // descripción o al nombre de la campaña (siempre hay algo que despachar).
    const body = (req.body.message as string | undefined)?.trim() || campaign.description || campaign.name;
    const subject = campaign.name;
    const channel = campaign.channel;

    // Destinatarios: mismos que GET /recipients — clientes del negocio con al
    // menos una reserva. Scoped por businessId (aislamiento multi-tenant).
    const bookings = await prisma.booking.findMany({
      where: { businessId },
      select: { clientId: true },
      distinct: ['clientId'],
    });
    const clientIds = bookings.map((b) => b.clientId);
    const recipients = clientIds.length
      ? await prisma.user.findMany({
          where: { id: { in: clientIds }, businessId },
          select: { id: true, name: true, email: true, phone: true },
        })
      : [];

    // Canales con envío saliente real hoy: WhatsApp y Email (hay adaptador +
    // dirección por-usuario en el schema). SMS y Telegram NO tienen destino
    // por-usuario persistido (número verificado / chatId), igual criterio que
    // services/notifications.ts; quedan como "no soportado aún".
    const soportado = channel === 'whatsapp' || channel === 'email';

    let enviados = 0;
    let fallidos = 0;

    if (soportado) {
      // Remitente dedicado del negocio para WhatsApp (mismo criterio que notifications).
      const senderNumber = channel === 'whatsapp' ? await resolveBusinessSender(businessId) : undefined;
      const waReady = channel === 'whatsapp' ? whatsapp.isConfigured() : true;

      // Secuencial: evita ráfagas contra Twilio/Resend. Un fallo por destinatario
      // se cuenta como fallido y NO corta el resto de la campaña.
      for (const r of recipients) {
        try {
          if (channel === 'email') {
            if (!r.email) {
              fallidos++;
              continue;
            }
            const ok = await sendGenericNotification(r.email, subject, body);
            if (ok) enviados++;
            else fallidos++;
          } else {
            // whatsapp
            if (!waReady || !r.phone) {
              fallidos++;
              continue;
            }
            await whatsapp.sendMessage(r.phone, body, senderNumber);
            enviados++;
          }
        } catch (err) {
          fallidos++;
          // describeError: no filtra el email/teléfono del destinatario en logs.
          console.error(`[Campaigns] Error enviando (canal ${channel}):`, describeError(err));
        }
      }
    } else {
      // Canal sin adaptador/dirección por-usuario: resumen honesto, todos fallidos.
      fallidos = recipients.length;
    }

    // El estado ya quedó en 'sent' por el claim atómico de arriba; acá solo
    // persistimos el conteo de enviados. openRate/clickRate: sin tracking.
    const updated = await prisma.campaign.update({
      where: { id },
      data: { sentCount: enviados },
    });

    getIO()?.to(`business:${businessId}`).emit('campaign:sent', {
      campaign: updated,
      envio: { enviados, fallidos },
    });

    res.json({ ...updated, envio: { enviados, fallidos, canalSoportado: soportado } });
  })
);

router.delete(
  '/:id',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const del = await prisma.campaign.deleteMany({
      where: { id: String(req.params.id), businessId: req.auth!.businessId },
    });
    if (del.count === 0) return res.status(404).json({ error: 'Campaign not found' });
    res.status(204).send();
  })
);

/**
 * Número de WhatsApp dedicado del negocio (remitente saliente). Es el mismo por
 * el que Twilio enruta los entrantes, así que está aprovisionado en la cuenta.
 * Devuelve undefined si el negocio no tiene uno (sendMessage cae al número global).
 */
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

/**
 * Describe un error para logs SIN filtrar PII del destinatario: los SDKs de
 * Twilio/Resend suelen incluir el número/email en `message`, así que logueamos
 * solo nombre y código (mismo criterio que services/notifications.ts).
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

export const campaignsRouter = router;
