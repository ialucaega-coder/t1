import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../middleware/errorHandler';

/** Serializa la lista de items al tipo JSON que espera Prisma. */
function toConfig(items: GalleryItem[]): Prisma.InputJsonValue {
  return { items } as unknown as Prisma.InputJsonValue;
}

/**
 * Superpoder "Galería": el negocio carga fotos/videos/audios reales (por URL)
 * que el bot puede compartir y que se muestran en el panel.
 *
 * Persistimos todo en el modelo Connection (schema bloqueado, no se toca),
 * usando type:'GALLERY' y guardando en config un array `items`. Sigue el
 * mismo patrón que otros servicios que guardan config en Connection sin
 * modificar el schema Prisma.
 */

export const GALLERY_TYPE = 'GALLERY';

export type GalleryTipo = 'image' | 'video' | 'audio';

export interface GalleryItem {
  id: string;
  url: string;
  tipo: GalleryTipo;
  titulo: string;
  descripcion: string;
  createdAt: string;
}

interface GalleryConfig {
  items: GalleryItem[];
}

export interface AddGalleryItemInput {
  url: string;
  tipo: GalleryTipo;
  titulo?: string;
  descripcion?: string;
}

export interface UpdateGalleryItemInput {
  url?: string;
  tipo?: GalleryTipo;
  titulo?: string;
  descripcion?: string;
}

/** Normaliza el config crudo de la Connection a una lista de items válida. */
function parseItems(config: unknown): GalleryItem[] {
  if (!config || typeof config !== 'object') return [];
  const raw = (config as GalleryConfig).items;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is GalleryItem =>
      !!item &&
      typeof item === 'object' &&
      typeof (item as GalleryItem).id === 'string' &&
      typeof (item as GalleryItem).url === 'string'
  );
}

/** Valida que la URL sea http(s). No se permiten otros esquemas. */
export function assertHttpUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError(400, 'La URL no es válida');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AppError(400, 'La URL debe comenzar con http:// o https://');
  }
}

/**
 * Aplica una mutación a la lista de items de forma atómica.
 *
 * Corre dentro de una transacción y bloquea la fila de la Connection con
 * `SELECT ... FOR UPDATE`, de modo que dos escrituras concurrentes (dos tabs,
 * doble click, reintentos) se serialicen y no se pisen (evita lost-update).
 * Nota: para una Connection que aún no existe, el create no puede bloquearse;
 * lo ideal a futuro es un @@unique([businessId, type]) en el schema para un
 * upsert 100% a prueba de carreras (hoy el schema está congelado).
 */
async function mutateGallery<T>(
  businessId: string,
  mutate: (items: GalleryItem[]) => { items: GalleryItem[]; result: T }
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    let conn = await tx.connection.findFirst({
      where: { businessId, type: GALLERY_TYPE },
      select: { id: true },
    });

    if (!conn) {
      conn = await tx.connection.create({
        data: {
          name: 'Galería',
          type: GALLERY_TYPE,
          icon: 'Images',
          config: toConfig([]),
          isActive: false,
          businessId,
        },
        select: { id: true },
      });
    } else {
      // Bloquea la fila hasta el fin de la transacción.
      await tx.$queryRaw`SELECT id FROM "connections" WHERE id = ${conn.id} FOR UPDATE`;
    }

    const fresh = await tx.connection.findUnique({
      where: { id: conn.id },
      select: { config: true },
    });
    const items = parseItems(fresh?.config);
    const { items: nextItems, result } = mutate(items);

    await tx.connection.update({
      where: { id: conn.id },
      data: { config: toConfig(nextItems) },
    });

    return result;
  });
}

/** Lista los items de la galería del negocio (más recientes primero). */
export async function loadGallery(businessId: string): Promise<GalleryItem[]> {
  const connection = await prisma.connection.findFirst({
    where: { businessId, type: GALLERY_TYPE },
  });
  if (!connection) return [];
  const items = parseItems(connection.config);
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Agrega un item a la galería y devuelve el item creado. */
export async function addItem(
  businessId: string,
  input: AddGalleryItemInput
): Promise<GalleryItem> {
  assertHttpUrl(input.url);
  const item: GalleryItem = {
    id: randomUUID(),
    url: input.url,
    tipo: input.tipo,
    titulo: input.titulo?.trim() ?? '',
    descripcion: input.descripcion?.trim() ?? '',
    createdAt: new Date().toISOString(),
  };

  return mutateGallery(businessId, (items) => ({
    items: [...items, item],
    result: item,
  }));
}

/** Actualiza un item existente y devuelve el item actualizado. */
export async function updateItem(
  businessId: string,
  itemId: string,
  input: UpdateGalleryItemInput
): Promise<GalleryItem> {
  if (input.url !== undefined) assertHttpUrl(input.url);

  return mutateGallery(businessId, (items) => {
    const index = items.findIndex((i) => i.id === itemId);
    if (index === -1) throw new AppError(404, 'Item de galería no encontrado');

    const updated: GalleryItem = {
      ...items[index],
      ...(input.url !== undefined ? { url: input.url } : {}),
      ...(input.tipo !== undefined ? { tipo: input.tipo } : {}),
      ...(input.titulo !== undefined ? { titulo: input.titulo.trim() } : {}),
      ...(input.descripcion !== undefined ? { descripcion: input.descripcion.trim() } : {}),
    };
    const next = [...items];
    next[index] = updated;
    return { items: next, result: updated };
  });
}

/** Elimina un item de la galería. */
export async function removeItem(businessId: string, itemId: string): Promise<void> {
  await mutateGallery(businessId, (items) => {
    const next = items.filter((i) => i.id !== itemId);
    if (next.length === items.length) throw new AppError(404, 'Item de galería no encontrado');
    return { items: next, result: undefined };
  });
}
