import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import type { Prisma } from '@prisma/client';

const router = Router();

const DEFAULT_ITEMS = [
  { name: 'Recordatorios automáticos', description: 'Envía recordatorios 24h antes de cada turno', category: 'Comercio', rating: 4.8, reviews: 234, price: 'Gratis', author: 'Local B', icon: 'Bell' },
  { name: 'Cobro automático', description: 'Cobra por MercadoPago o Stripe al confirmar reserva', category: 'Comercio', rating: 4.6, reviews: 189, price: '$2.990/mes', author: 'Local B', icon: 'CreditCard' },
  { name: 'Fidelización', description: 'Sistema de puntos y recompensas para clientes frecuentes', category: 'Comercio', rating: 4.5, reviews: 156, price: 'Gratis', author: 'Local B', icon: 'Star' },
  { name: 'Encuestas post-servicio', description: 'Pide feedback automático después de cada servicio', category: 'Servicios', rating: 4.3, reviews: 98, price: 'Gratis', author: 'Local B', icon: 'MessageSquare' },
  { name: 'Menú digital QR', description: 'Genera un menú digital con QR para tu negocio', category: 'Gastronomia', rating: 4.7, reviews: 312, price: 'Gratis', author: 'Local B', icon: 'QrCode' },
  { name: 'Historia clínica', description: 'Registro de historia clínica por paciente', category: 'Salud', rating: 4.9, reviews: 67, price: '$4.990/mes', author: 'Local B', icon: 'Heart' },
  { name: 'Agenda educativa', description: 'Gestión de clases, alumnos y asistencia', category: 'Educacion', rating: 4.4, reviews: 45, price: 'Gratis', author: 'Local B', icon: 'GraduationCap' },
  { name: 'Multi-sucursal', description: 'Gestiona múltiples ubicaciones desde un panel', category: 'Comercio', rating: 4.2, reviews: 78, price: '$5.990/mes', author: 'Local B', icon: 'MapPin' },
];

async function ensureDefaults() {
  const count = await prisma.marketplaceItem.count();
  if (count === 0) {
    await prisma.marketplaceItem.createMany({ data: DEFAULT_ITEMS });
  }
}

router.get(
  '/items',
  requireAuth,
  asyncHandler(async (req, res) => {
    await ensureDefaults();
    const category = req.query.category as string | undefined;
    const search = req.query.search as string | undefined;
    const where: Prisma.MarketplaceItemWhereInput = { isPublished: true };
    if (category && category !== 'Todos') where.category = category;
    if (search) where.name = { contains: search, mode: 'insensitive' };
    const items = await prisma.marketplaceItem.findMany({
      where,
      orderBy: { rating: 'desc' },
    });
    const installs = await prisma.marketplaceInstall.findMany({
      where: { businessId: req.auth!.businessId },
      select: { itemId: true },
    });
    const installedIds = new Set(installs.map((i) => i.itemId));
    res.json(items.map((item) => ({ ...item, installed: installedIds.has(item.id) })));
  })
);

router.post(
  '/items/:id/install',
  requireAuth,
  asyncHandler(async (req, res) => {
    const existing = await prisma.marketplaceInstall.findUnique({
      where: { itemId_businessId: { itemId: req.params.id as string, businessId: req.auth!.businessId } },
    });
    if (existing) return res.status(409).json({ error: 'Already installed' });
    await prisma.marketplaceInstall.create({
      data: { itemId: req.params.id as string, businessId: req.auth!.businessId },
    });
    res.status(201).json({ success: true });
  })
);

router.delete(
  '/items/:id/install',
  requireAuth,
  asyncHandler(async (req, res) => {
    await prisma.marketplaceInstall.deleteMany({
      where: { itemId: req.params.id as string, businessId: req.auth!.businessId },
    });
    res.status(204).send();
  })
);

export const marketplaceRouter = router;
