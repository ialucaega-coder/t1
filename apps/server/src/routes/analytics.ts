import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';

const router = Router();

const COST_PER_1K_TOKENS = 0.003;
const AVG_TOKENS_PER_MESSAGE = 150;

router.get(
  '/kpi',
  requireAuth,
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [totalConversations, totalBookings, completedBookings, revenue, closedConvos, totalConvos, botMessages, avgResponseTime] = await Promise.all([
      prisma.conversation.count({ where: { businessId, createdAt: { gte: thirtyDaysAgo } } }),
      prisma.booking.count({ where: { businessId, createdAt: { gte: thirtyDaysAgo } } }),
      prisma.booking.count({ where: { businessId, status: 'COMPLETED', createdAt: { gte: thirtyDaysAgo } } }),
      prisma.transaction.aggregate({ where: { businessId, createdAt: { gte: thirtyDaysAgo } }, _sum: { amount: true } }),
      prisma.conversation.count({ where: { businessId, status: 'CLOSED', createdAt: { gte: thirtyDaysAgo } } }),
      prisma.conversation.count({ where: { businessId, createdAt: { gte: thirtyDaysAgo } } }),
      prisma.message.count({
        where: { role: 'BOT', createdAt: { gte: thirtyDaysAgo }, conversation: { businessId } },
      }),
      prisma.message.aggregate({
        where: { role: 'BOT', responseTime: { not: null }, createdAt: { gte: thirtyDaysAgo }, conversation: { businessId } },
        _avg: { responseTime: true },
      }),
    ]);

    const resolutionRate = totalConvos > 0 ? closedConvos / totalConvos : 0;
    const avgRespMs = avgResponseTime._avg.responseTime || 0;
    const responseScore = avgRespMs === 0 ? 5 : avgRespMs < 1000 ? 5 : avgRespMs < 3000 ? 4 : avgRespMs < 5000 ? 3 : avgRespMs < 10000 ? 2 : 1;
    const avgSatisfaction = parseFloat(((resolutionRate * 3 + responseScore * 2) / 5).toFixed(1)) || 0;

    const estimatedTokens = botMessages * AVG_TOKENS_PER_MESSAGE;
    const monthlyAiCost = parseFloat(((estimatedTokens / 1000) * COST_PER_1K_TOKENS).toFixed(2));

    const conversionRate = totalBookings > 0 ? ((completedBookings / totalBookings) * 100).toFixed(1) : '0';

    res.json({
      totalConversations,
      avgSatisfaction,
      monthlyAiCost,
      conversionRate: parseFloat(conversionRate),
      monthlyBudget: 50,
    });
  })
);

router.get(
  '/conversations',
  requireAuth,
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const days = 7;
    const result = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      const count = await prisma.conversation.count({
        where: { businessId, createdAt: { gte: dayStart, lt: dayEnd } },
      });
      result.push({
        day: dayStart.toLocaleDateString('es-AR', { weekday: 'short' }),
        count,
      });
    }
    res.json(result);
  })
);

router.get(
  '/satisfaction',
  requireAuth,
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [closed, handoff, open, totalWithResponse, avgResp] = await Promise.all([
      prisma.conversation.count({ where: { businessId, status: 'CLOSED', createdAt: { gte: thirtyDaysAgo } } }),
      prisma.conversation.count({ where: { businessId, status: 'HANDOFF', createdAt: { gte: thirtyDaysAgo } } }),
      prisma.conversation.count({ where: { businessId, status: 'OPEN', createdAt: { gte: thirtyDaysAgo } } }),
      prisma.message.count({
        where: { role: 'BOT', responseTime: { not: null }, createdAt: { gte: thirtyDaysAgo }, conversation: { businessId } },
      }),
      prisma.message.aggregate({
        where: { role: 'BOT', responseTime: { not: null }, createdAt: { gte: thirtyDaysAgo }, conversation: { businessId } },
        _avg: { responseTime: true },
      }),
    ]);

    const total = closed + handoff + open;
    if (total === 0) {
      return res.json([
        { stars: 5, count: 0, color: '#22c55e' },
        { stars: 4, count: 0, color: '#84cc16' },
        { stars: 3, count: 0, color: '#eab308' },
        { stars: 2, count: 0, color: '#f97316' },
        { stars: 1, count: 0, color: '#ef4444' },
      ]);
    }

    const star5 = closed;
    const star4 = Math.round(open * 0.6);
    const star3 = Math.round(open * 0.4);
    const star2 = Math.round(handoff * 0.6);
    const star1 = Math.round(handoff * 0.4);

    res.json([
      { stars: 5, count: star5, color: '#22c55e' },
      { stars: 4, count: star4, color: '#84cc16' },
      { stars: 3, count: star3, color: '#eab308' },
      { stars: 2, count: star2, color: '#f97316' },
      { stars: 1, count: star1, color: '#ef4444' },
    ]);
  })
);

router.get(
  '/improvements',
  requireAuth,
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [handoffCount, totalConvos, avgResp, botMsgCount, totalMsgCount, pendingBookings, totalBookings] = await Promise.all([
      prisma.conversation.count({ where: { businessId, status: 'HANDOFF', createdAt: { gte: thirtyDaysAgo } } }),
      prisma.conversation.count({ where: { businessId, createdAt: { gte: thirtyDaysAgo } } }),
      prisma.message.aggregate({
        where: { role: 'BOT', responseTime: { not: null }, createdAt: { gte: thirtyDaysAgo }, conversation: { businessId } },
        _avg: { responseTime: true },
      }),
      prisma.message.count({ where: { role: 'BOT', createdAt: { gte: thirtyDaysAgo }, conversation: { businessId } } }),
      prisma.message.count({ where: { createdAt: { gte: thirtyDaysAgo }, conversation: { businessId } } }),
      prisma.booking.count({ where: { businessId, status: 'PENDING', createdAt: { gte: thirtyDaysAgo } } }),
      prisma.booking.count({ where: { businessId, createdAt: { gte: thirtyDaysAgo } } }),
    ]);

    const improvements: { id: string; title: string; category: string; severity: string; description: string }[] = [];
    let idx = 1;

    const avgRespMs = avgResp._avg.responseTime || 0;
    if (avgRespMs > 3000) {
      improvements.push({
        id: String(idx++),
        title: 'Optimizar tiempo de respuesta del bot',
        category: 'Performance',
        severity: 'alta',
        description: `El tiempo promedio de respuesta es ${(avgRespMs / 1000).toFixed(1)}s. Se recomienda optimizar los prompts o usar un modelo más rápido.`,
      });
    }

    const handoffRate = totalConvos > 0 ? handoffCount / totalConvos : 0;
    if (handoffRate > 0.2) {
      improvements.push({
        id: String(idx++),
        title: 'Reducir tasa de escalamiento a humanos',
        category: 'Contenido',
        severity: 'alta',
        description: `El ${(handoffRate * 100).toFixed(0)}% de las conversaciones requiere intervención humana. Revisá los prompts y las habilidades del bot.`,
      });
    }

    const pendingRate = totalBookings > 0 ? pendingBookings / totalBookings : 0;
    if (pendingRate > 0.3) {
      improvements.push({
        id: String(idx++),
        title: 'Mejorar confirmación de reservas',
        category: 'UX',
        severity: 'media',
        description: `El ${(pendingRate * 100).toFixed(0)}% de las reservas están pendientes de confirmación. Considerá habilitar confirmación automática.`,
      });
    }

    const botRatio = totalMsgCount > 0 ? botMsgCount / totalMsgCount : 0;
    if (botRatio < 0.3 && totalMsgCount > 10) {
      improvements.push({
        id: String(idx++),
        title: 'Aumentar automatización de respuestas',
        category: 'Config',
        severity: 'media',
        description: `Solo el ${(botRatio * 100).toFixed(0)}% de los mensajes son del bot. Configurá más habilidades para aumentar la automatización.`,
      });
    }

    if (totalConvos === 0) {
      improvements.push({
        id: String(idx++),
        title: 'Activar un canal de comunicación',
        category: 'Config',
        severity: 'alta',
        description: 'No hay conversaciones registradas. Conectá WhatsApp, Telegram u otro canal para empezar a recibir clientes.',
      });
    }

    if (improvements.length === 0) {
      improvements.push({
        id: '1',
        title: 'Todo en orden',
        category: 'Info',
        severity: 'baja',
        description: 'No se detectaron problemas significativos en los últimos 30 días. ¡Buen trabajo!',
      });
    }

    res.json(improvements);
  })
);

router.get(
  '/costs',
  requireAuth,
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const botMessages = await prisma.message.findMany({
      where: { role: 'BOT', createdAt: { gte: thirtyDaysAgo }, conversation: { businessId } },
      select: { text: true },
    });

    const totalChars = botMessages.reduce((sum, m) => sum + m.text.length, 0);
    const estimatedTokens = Math.round(totalChars / 4);

    const primaryTokens = Math.round(estimatedTokens * 0.7);
    const secondaryTokens = Math.round(estimatedTokens * 0.3);

    const primaryCost = parseFloat(((primaryTokens / 1000) * 0.003).toFixed(2));
    const secondaryCost = parseFloat(((secondaryTokens / 1000) * 0.0004).toFixed(2));

    res.json([
      { model: 'Claude Sonnet', tokens: primaryTokens, cost: primaryCost },
      { model: 'Claude Haiku', tokens: secondaryTokens, cost: secondaryCost },
    ]);
  })
);

router.get(
  '/metrics',
  requireAuth,
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [avgResp, totalMessages, totalConvos, closedConvos, handoffConvos, botBookings] = await Promise.all([
      prisma.message.aggregate({
        where: { role: 'BOT', responseTime: { not: null }, createdAt: { gte: thirtyDaysAgo }, conversation: { businessId } },
        _avg: { responseTime: true },
      }),
      prisma.message.count({
        where: { createdAt: { gte: thirtyDaysAgo }, conversation: { businessId } },
      }),
      prisma.conversation.count({ where: { businessId, createdAt: { gte: thirtyDaysAgo } } }),
      prisma.conversation.count({ where: { businessId, status: 'CLOSED', createdAt: { gte: thirtyDaysAgo } } }),
      prisma.conversation.count({ where: { businessId, status: 'HANDOFF', createdAt: { gte: thirtyDaysAgo } } }),
      prisma.booking.count({ where: { businessId, source: { in: ['TELEGRAM', 'WHATSAPP'] }, createdAt: { gte: thirtyDaysAgo } } }),
    ]);

    const avgRespMs = avgResp._avg.responseTime || 0;
    const msgsPerConvo = totalConvos > 0 ? (totalMessages / totalConvos).toFixed(1) : '0';
    const resolutionRate = totalConvos > 0 ? ((closedConvos / totalConvos) * 100).toFixed(0) : '0';
    const handoffRate = totalConvos > 0 ? ((handoffConvos / totalConvos) * 100).toFixed(0) : '0';

    res.json([
      { label: 'Tiempo promedio de respuesta', value: avgRespMs > 0 ? `${(avgRespMs / 1000).toFixed(1)}s` : '—' },
      { label: 'Mensajes por conversación', value: msgsPerConvo },
      { label: 'Tasa de resolución', value: `${resolutionRate}%` },
      { label: 'Escalaciones a humano', value: `${handoffRate}%` },
      { label: 'Reservas por bot', value: String(botBookings) },
    ]);
  })
);

export const analyticsRouter = router;
