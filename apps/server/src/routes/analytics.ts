import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';

const router = Router();

router.get(
  '/kpi',
  requireAuth,
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [totalConversations, totalBookings, completedBookings, revenue] = await Promise.all([
      prisma.conversation.count({ where: { businessId, createdAt: { gte: thirtyDaysAgo } } }),
      prisma.booking.count({ where: { businessId, createdAt: { gte: thirtyDaysAgo } } }),
      prisma.booking.count({ where: { businessId, status: 'COMPLETED', createdAt: { gte: thirtyDaysAgo } } }),
      prisma.transaction.aggregate({ where: { businessId, createdAt: { gte: thirtyDaysAgo } }, _sum: { amount: true } }),
    ]);

    const conversionRate = totalBookings > 0 ? ((completedBookings / totalBookings) * 100).toFixed(1) : '0';

    res.json({
      totalConversations,
      avgSatisfaction: 4.3,
      monthlyAiCost: 25.75,
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
  asyncHandler(async (_req, res) => {
    res.json([
      { stars: 5, count: 145, color: '#22c55e' },
      { stars: 4, count: 89, color: '#84cc16' },
      { stars: 3, count: 34, color: '#eab308' },
      { stars: 2, count: 18, color: '#f97316' },
      { stars: 1, count: 10, color: '#ef4444' },
    ]);
  })
);

router.get(
  '/improvements',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json([
      { id: '1', title: 'Mejorar tiempo de respuesta en WhatsApp', category: 'Performance', severity: 'alta', description: 'El bot tarda más de 5 segundos en responder mensajes complejos' },
      { id: '2', title: 'Agregar respuestas para preguntas de ubicación', category: 'Contenido', severity: 'media', description: 'Los clientes preguntan frecuentemente por la dirección y no hay respuesta configurada' },
      { id: '3', title: 'Optimizar flujo de reserva', category: 'UX', severity: 'media', description: 'El flujo de reserva tiene 5 pasos, podría reducirse a 3' },
      { id: '4', title: 'Configurar horarios de atención del bot', category: 'Config', severity: 'baja', description: 'El bot responde 24/7 pero el negocio atiende solo en horario comercial' },
    ]);
  })
);

router.get(
  '/costs',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json([
      { model: 'Claude Sonnet', tokens: 125000, cost: 12.50 },
      { model: 'Claude Haiku', tokens: 340000, cost: 8.50 },
      { model: 'GPT-4o Mini', tokens: 89000, cost: 3.25 },
      { model: 'Whisper', tokens: 15000, cost: 1.50 },
    ]);
  })
);

export const analyticsRouter = router;
