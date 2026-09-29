/**
 * Pruebas del servicio de Galería (`src/services/gallery/config.ts`):
 * validación de URL, carga/orden de items, y mutaciones atómicas con el
 * patrón create-if-missing + `SELECT ... FOR UPDATE` + lectura fresca
 * (evita lost-update entre escrituras concurrentes). La persistencia vive
 * en Connection(type='GALLERY').config.items sin tocar el schema.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    connection: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

import { prisma } from '../../lib/prisma';
import {
  assertHttpUrl,
  loadGallery,
  addItem,
  updateItem,
  removeItem,
  GALLERY_TYPE,
  type GalleryItem,
} from '../../services/gallery/config';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

/** Construye un item de galería válido para los fixtures. */
function item(overrides: Partial<GalleryItem> = {}): GalleryItem {
  return {
    id: overrides.id ?? 'item_1',
    url: overrides.url ?? 'https://cdn.example.com/foto.jpg',
    tipo: overrides.tipo ?? 'image',
    titulo: overrides.titulo ?? 'Foto',
    descripcion: overrides.descripcion ?? '',
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mock(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
  mock(prisma.$queryRaw).mockResolvedValue([]);
  mock(prisma.connection.update).mockResolvedValue({});
});

describe('services/gallery/config', () => {
  describe('assertHttpUrl', () => {
    it('acepta http y https', () => {
      expect(() => assertHttpUrl('http://a.com/x.png')).not.toThrow();
      expect(() => assertHttpUrl('https://a.com/x.png')).not.toThrow();
    });

    it('rechaza esquemas no http (ftp, javascript, data)', () => {
      expect(() => assertHttpUrl('ftp://a.com/x')).toThrow(/http:\/\/ o https:\/\//);
      expect(() => assertHttpUrl('javascript:alert(1)')).toThrow(/http/);
      expect(() => assertHttpUrl('data:text/html,<script>')).toThrow(/http/);
    });

    it('rechaza una URL malformada', () => {
      expect(() => assertHttpUrl('no es una url')).toThrow(/no es válida/);
    });
  });

  describe('loadGallery', () => {
    it('devuelve [] cuando el negocio no tiene galería', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue(null);
      expect(await loadGallery('biz_1')).toEqual([]);
    });

    it('ordena por createdAt descendente (más recientes primero)', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue({
        config: {
          items: [
            item({ id: 'a', createdAt: '2026-01-01T00:00:00.000Z' }),
            item({ id: 'c', createdAt: '2026-03-01T00:00:00.000Z' }),
            item({ id: 'b', createdAt: '2026-02-01T00:00:00.000Z' }),
          ],
        },
      });
      const items = await loadGallery('biz_1');
      expect(items.map((i) => i.id)).toEqual(['c', 'b', 'a']);
    });

    it('descarta items con forma inválida (sin id o sin url)', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue({
        config: { items: [item({ id: 'ok' }), { url: 'https://x.com' }, { id: 'no-url' }, null] },
      });
      const items = await loadGallery('biz_1');
      expect(items.map((i) => i.id)).toEqual(['ok']);
    });
  });

  describe('addItem', () => {
    it('valida la URL antes de tocar la DB', async () => {
      await expect(addItem('biz_1', { url: 'ftp://x', tipo: 'image' })).rejects.toThrow(/http/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('crea la Connection cuando no existe y agrega el item', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue(null);
      mock(prisma.connection.create).mockResolvedValue({ id: 'conn_new' });
      mock(prisma.connection.findUnique).mockResolvedValue({ config: { items: [] } });

      const created = await addItem('biz_1', {
        url: 'https://cdn.example.com/nuevo.jpg',
        tipo: 'image',
        titulo: '  Con espacios  ',
      });

      expect(prisma.connection.create).toHaveBeenCalledTimes(1);
      expect(prisma.connection.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: GALLERY_TYPE, businessId: 'biz_1' }) })
      );
      expect(prisma.$queryRaw).not.toHaveBeenCalled(); // no hay fila que bloquear
      expect(created.id).toEqual(expect.any(String));
      expect(created.titulo).toBe('Con espacios'); // trim aplicado
      expect(created.descripcion).toBe(''); // default cuando no se pasa
    });

    it('toma el lock y agrega sobre los items frescos (no pisa lo existente)', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue({ id: 'conn_1' });
      mock(prisma.connection.findUnique).mockResolvedValue({
        config: { items: [item({ id: 'previo' })] },
      });

      const created = await addItem('biz_1', { url: 'https://cdn.example.com/2.jpg', tipo: 'video' });

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1); // FOR UPDATE
      expect(prisma.connection.create).not.toHaveBeenCalled();
      const updateArg = mock(prisma.connection.update).mock.calls[0][0];
      const savedItems = (updateArg.data.config as { items: GalleryItem[] }).items;
      expect(savedItems.map((i) => i.id)).toEqual(['previo', created.id]);
    });
  });

  describe('updateItem', () => {
    it('lanza 404 cuando el item no existe', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue({ id: 'conn_1' });
      mock(prisma.connection.findUnique).mockResolvedValue({ config: { items: [item({ id: 'otro' })] } });

      await expect(updateItem('biz_1', 'inexistente', { titulo: 'x' })).rejects.toThrow(/no encontrado/);
    });

    it('actualiza solo los campos provistos y respeta el resto', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue({ id: 'conn_1' });
      mock(prisma.connection.findUnique).mockResolvedValue({
        config: { items: [item({ id: 'x', titulo: 'Viejo', descripcion: 'desc' })] },
      });

      const updated = await updateItem('biz_1', 'x', { titulo: '  Nuevo  ' });

      expect(updated.titulo).toBe('Nuevo'); // trim
      expect(updated.descripcion).toBe('desc'); // sin cambios
    });

    it('valida la URL cuando se pasa una nueva', async () => {
      await expect(updateItem('biz_1', 'x', { url: 'javascript:alert(1)' })).rejects.toThrow(/http/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('removeItem', () => {
    it('elimina el item cuando existe', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue({ id: 'conn_1' });
      mock(prisma.connection.findUnique).mockResolvedValue({
        config: { items: [item({ id: 'a' }), item({ id: 'b' })] },
      });

      await removeItem('biz_1', 'a');

      const updateArg = mock(prisma.connection.update).mock.calls[0][0];
      const savedItems = (updateArg.data.config as { items: GalleryItem[] }).items;
      expect(savedItems.map((i) => i.id)).toEqual(['b']);
    });

    it('lanza 404 cuando el item no existe', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue({ id: 'conn_1' });
      mock(prisma.connection.findUnique).mockResolvedValue({ config: { items: [item({ id: 'a' })] } });

      await expect(removeItem('biz_1', 'inexistente')).rejects.toThrow(/no encontrado/);
    });
  });
});
