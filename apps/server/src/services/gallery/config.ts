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

/** Devuelve la Connection de galería del negocio, creándola si no existe. */
async function getOrCreateConnection(businessId: string) {
  const existing = await prisma.connection.findFirst({
    where: { businessId, type: GALLERY_TYPE },
  });
  if (existing) return existing;

  return prisma.connection.create({
    data: {
      name: 'Galería',
      type: GALLERY_TYPE,
      icon: 'Images',
      config: toConfig([]),
      isActive: false,
      businessId,
    },
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
  const connection = await getOrCreateConnection(businessId);
  const items = parseItems(connection.config);

  const item: GalleryItem = {
    id: randomUUID(),
    url: input.url,
    tipo: input.tipo,
    titulo: input.titulo?.trim() ?? '',
    descripcion: input.descripcion?.trim() ?? '',
    createdAt: new Date().toISOString(),
  };

  await prisma.connection.update({
    where: { id: connection.id },
    data: { config: toConfig([...items, item]) },
  });

  return item;
}

/** Actualiza un item existente y devuelve el item actualizado. */
export async function updateItem(
  businessId: string,
  itemId: string,
  input: UpdateGalleryItemInput
): Promise<GalleryItem> {
  if (input.url !== undefined) assertHttpUrl(input.url);

  const connection = await prisma.connection.findFirst({
    where: { businessId, type: GALLERY_TYPE },
  });
  if (!connection) throw new AppError(404, 'Item de galería no encontrado');

  const items = parseItems(connection.config);
  const index = items.findIndex((i) => i.id === itemId);
  if (index === -1) throw new AppError(404, 'Item de galería no encontrado');

  const updated: GalleryItem = {
    ...items[index],
    ...(input.url !== undefined ? { url: input.url } : {}),
    ...(input.tipo !== undefined ? { tipo: input.tipo } : {}),
    ...(input.titulo !== undefined ? { titulo: input.titulo.trim() } : {}),
    ...(input.descripcion !== undefined ? { descripcion: input.descripcion.trim() } : {}),
  };
  items[index] = updated;

  await prisma.connection.update({
    where: { id: connection.id },
    data: { config: toConfig(items) },
  });

  return updated;
}

/** Elimina un item de la galería. */
export async function removeItem(businessId: string, itemId: string): Promise<void> {
  const connection = await prisma.connection.findFirst({
    where: { businessId, type: GALLERY_TYPE },
  });
  if (!connection) throw new AppError(404, 'Item de galería no encontrado');

  const items = parseItems(connection.config);
  const next = items.filter((i) => i.id !== itemId);
  if (next.length === items.length) throw new AppError(404, 'Item de galería no encontrado');

  await prisma.connection.update({
    where: { id: connection.id },
    data: { config: toConfig(next) },
  });
}
