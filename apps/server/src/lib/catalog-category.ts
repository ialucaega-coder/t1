import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';

/**
 * Multi-tenant: una categoría solo se puede asignar a un producto/servicio si
 * pertenece al mismo negocio. Sin esto, un ADMIN podía enlazar su producto a la
 * categoría de otro negocio con solo conocer el id.
 */
export async function categoryBelongsToBusiness(businessId: string, categoryId: string): Promise<boolean> {
  const category = await prisma.category.findFirst({
    where: { id: categoryId, businessId },
    select: { id: true },
  });
  return Boolean(category);
}

/** Clave del lock de nombres de categoría de un negocio. */
export function categoryNameLockKey(businessId: string): string {
  return `category-name:${businessId}`;
}

/**
 * Advisory lock transaccional por (negocio, 'category-name'). Serializa el
 * "chequear nombre duplicado + crear/renombrar": sin esto, dos altas simultáneas
 * con el mismo nombre ven ambas "no existe" y duplican (el schema está congelado:
 * no hay UNIQUE por (businessId, name)). Se libera solo al terminar la transacción.
 * Debe llamarse ANTES del chequeo de duplicado.
 */
export async function lockCategoryName(
  tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
  businessId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${categoryNameLockKey(businessId)}, 0))`;
}
