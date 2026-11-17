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
