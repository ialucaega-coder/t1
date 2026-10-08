/**
 * Pruebas del servicio de config de UI del panel White Label
 * (`src/services/whitelabel/config.ts`): normalización de tema y secciones,
 * carga con defaults y guardado transaccional (merge sobre el config fresco).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
    connection: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

import { prisma } from '../../lib/prisma';
import {
  sanitizeHiddenSections,
  loadWhitelabelUi,
  saveWhitelabelUi,
  DEFAULT_WHITELABEL_UI,
} from '../../services/whitelabel/config';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

describe('services/whitelabel/config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
    mock(prisma.$queryRaw).mockResolvedValue([]);
  });

  describe('sanitizeHiddenSections', () => {
    it('filtra secciones inválidas y deduplica', () => {
      expect(sanitizeHiddenSections(['Arena', 'NoExiste', 'Arena', 'Costos'])).toEqual(['Arena', 'Costos']);
    });

    it('devuelve [] si no es un array', () => {
      expect(sanitizeHiddenSections('Arena')).toEqual([]);
      expect(sanitizeHiddenSections(null)).toEqual([]);
    });
  });

  describe('loadWhitelabelUi', () => {
    it('devuelve los defaults cuando no hay registro', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue(null);
      await expect(loadWhitelabelUi('biz_1')).resolves.toEqual(DEFAULT_WHITELABEL_UI);
    });

    it('normaliza un config guardado (tema inválido → default; secciones filtradas)', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue({
        config: { theme: 'galactic', hiddenSections: ['Arena', 'Basura'] },
      });
      await expect(loadWhitelabelUi('biz_1')).resolves.toEqual({
        theme: 'onyx',
        hiddenSections: ['Arena'],
      });
    });
  });

  describe('saveWhitelabelUi', () => {
    it('crea el registro cuando no existe y mergea el parche', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue(null);
      mock(prisma.connection.create).mockResolvedValue({ id: 'conn_1' });
      mock(prisma.connection.findUnique).mockResolvedValue({ config: DEFAULT_WHITELABEL_UI });
      mock(prisma.connection.update).mockResolvedValue({});

      const res = await saveWhitelabelUi('biz_1', { theme: 'terra' });

      expect(res).toEqual({ theme: 'terra', hiddenSections: [] });
      expect(prisma.connection.create).toHaveBeenCalled();
      expect(prisma.connection.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ config: { theme: 'terra', hiddenSections: [] } }) })
      );
    });

    it('bloquea la fila y mergea sin pisar el campo no incluido en el parche', async () => {
      mock(prisma.connection.findFirst).mockResolvedValue({ id: 'conn_1' });
      mock(prisma.connection.findUnique).mockResolvedValue({
        config: { theme: 'nimbus', hiddenSections: ['Costos'] },
      });
      mock(prisma.connection.update).mockResolvedValue({});

      const res = await saveWhitelabelUi('biz_1', { hiddenSections: ['Arena'] });

      expect(res).toEqual({ theme: 'nimbus', hiddenSections: ['Arena'] });
      expect(prisma.connection.create).not.toHaveBeenCalled();
      expect(prisma.$queryRaw).toHaveBeenCalled();
    });
  });
});
