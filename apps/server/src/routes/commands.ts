import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { DEFAULT_COMMAND_GROUPS } from '../constants/defaultCatalog';

const router = Router();

async function ensureDefaultCommands(businessId: string) {
  // Fast path sin lock: si ya hay comandos, no hacemos nada.
  if ((await prisma.command.count({ where: { businessId } })) > 0) return;

  // Seed race-safe: dos requests del mismo negocio recién creado podrían pasar
  // ambas el count===0 y duplicar el catálogo (no hay unique constraint por el
  // freeze de schema). Un advisory lock transaccional por negocio los serializa
  // y re-chequeamos adentro con el lock tomado.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`seed-commands:${businessId}`}, 0))`;
    if ((await tx.command.count({ where: { businessId } })) > 0) return;

    await tx.command.createMany({
      data: DEFAULT_COMMAND_GROUPS.flatMap((group, groupIndex) =>
        group.items.map((item, itemIndex) => ({
          businessId,
          name: item.name,
          description: item.desc,
          template: item.name,
          category: group.category,
          sortOrder: groupIndex * 100 + itemIndex,
        }))
      ),
    });
  });
}

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;
    await ensureDefaultCommands(businessId);

    const rows = await prisma.command.findMany({
      where: { businessId },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });

    const grouped = rows.reduce<Record<string, { category: string; items: { name: string; desc: string }[] }>>(
      (acc, command) => {
        const category = command.category || 'General';
        acc[category] ??= { category, items: [] };
        acc[category].items.push({ name: command.name, desc: command.description ?? command.template });
        return acc;
      },
      {}
    );

    res.json(Object.values(grouped));
  })
);

export { router as commandsRouter };
