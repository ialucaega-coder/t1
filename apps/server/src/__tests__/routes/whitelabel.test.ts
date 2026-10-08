/**
 * Pruebas de integracion para las rutas de White Label
 * (`src/routes/whitelabel.ts`): lectura de la config de marca del negocio
 * (scope por businessId), actualizacion parcial (200 + validacion 400 con Zod,
 * solo ADMIN) y preview publico.
 *
 * Se mockean Prisma y el middleware de auth (requireAuth + requireRole).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
    business: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../../services/whitelabel/config', () => ({
  WHITELABEL_THEMES: ['nimbus', 'onyx', 'terra'],
  WHITELABEL_SECTIONS: ['Costos', 'Configuración IA', 'Arena', 'Marketplace'],
  loadWhitelabelUi: vi.fn(async () => ({ theme: 'onyx', hiddenSections: [] })),
  saveWhitelabelUi: vi.fn(async (_businessId: string, patch: Record<string, unknown>) => ({
    theme: (patch.theme as string) ?? 'onyx',
    hiddenSections: (patch.hiddenSections as string[]) ?? [],
  })),
}));

vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: 'user_1', businessId: 'biz_1', role: 'ADMIN' };
    next();
  },
  requireRole:
    (...roles: string[]) =>
    (req: Request, res: Response, next: NextFunction) => {
      if (!roles.includes(req.auth?.role ?? '')) {
        res.status(403).json({ error: 'Insufficient permissions' });
        return;
      }
      next();
    },
}));

import { prisma } from '../../lib/prisma';
import { whitelabelRouter } from '../../routes/whitelabel';
import { saveWhitelabelUi } from '../../services/whitelabel/config';
import { errorHandler } from '../../middleware/errorHandler';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/whitelabel', whitelabelRouter);
  app.use(errorHandler);
  return app;
}

const businessRow = {
  id: 'biz_1',
  name: 'Peluqueria Ana',
  slug: 'peluqueria-ana',
  description: 'La mejor peluqueria',
  logo: null,
  primaryColor: '#111111',
  secondaryColor: '#222222',
  accentColor: '#3366FF',
  customDomain: null,
  phone: null,
  whatsappNumber: null,
  instagramUrl: null,
  facebookUrl: null,
  websiteUrl: null,
};

describe('routes/whitelabel', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    // El PATCH envuelve el update en una transacción con advisory lock (unicidad
    // de número); el mock ejecuta el callback con el prisma mockeado como tx.
    mock(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
    mock(prisma.$executeRaw).mockResolvedValue(0);
    mock(prisma.business.findFirst).mockResolvedValue(null); // por defecto, número libre
  });

  describe('GET /api/whitelabel', () => {
    it('devuelve la config de marca del negocio (scope por businessId)', async () => {
      mock(prisma.business.findUnique).mockResolvedValue(businessRow);

      const res = await request(app).get('/api/whitelabel');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: 'biz_1', name: 'Peluqueria Ana', slug: 'peluqueria-ana' });
      expect(prisma.business.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'biz_1' } })
      );
    });

    it('incluye la config de UI del panel (theme + hiddenSections)', async () => {
      mock(prisma.business.findUnique).mockResolvedValue(businessRow);

      const res = await request(app).get('/api/whitelabel');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ theme: 'onyx', hiddenSections: [] });
    });
  });

  describe('PATCH /api/whitelabel', () => {
    it('actualiza la config de marca del negocio (scope por businessId)', async () => {
      mock(prisma.business.update).mockResolvedValue({ ...businessRow, name: 'Nuevo Nombre' });

      const res = await request(app)
        .patch('/api/whitelabel')
        .send({ name: 'Nuevo Nombre', primaryColor: '#000000' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ name: 'Nuevo Nombre' });
      expect(prisma.business.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'biz_1' },
          data: expect.objectContaining({ name: 'Nuevo Nombre', primaryColor: '#000000' }),
        })
      );
    });

    it('rechaza (409) un whatsappNumber ya usado por otro negocio', async () => {
      mock(prisma.business.findFirst).mockResolvedValue({ id: 'otro_biz' }); // número tomado
      const res = await request(app).patch('/api/whitelabel').send({ name: 'X', whatsappNumber: '+5491122223333' });
      expect(res.status).toBe(409);
      expect(prisma.business.update).not.toHaveBeenCalled();
    });

    it('permite guardar un número libre (no tomado por otro negocio)', async () => {
      mock(prisma.business.findFirst).mockResolvedValue(null);
      mock(prisma.business.update).mockResolvedValue({ ...businessRow, whatsappNumber: '+5491122223333' });
      const res = await request(app).patch('/api/whitelabel').send({ name: 'X', whatsappNumber: '+5491122223333' });
      expect(res.status).toBe(200);
      expect(prisma.business.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: { not: 'biz_1' } }) })
      );
    });

    it('devuelve 400 con un name vacio (validacion Zod)', async () => {
      const res = await request(app).patch('/api/whitelabel').send({ name: '' });

      expect(res.status).toBe(400);
      expect(prisma.business.update).not.toHaveBeenCalled();
    });

    it('devuelve 400 con una URL de logo invalida (validacion Zod)', async () => {
      const res = await request(app).patch('/api/whitelabel').send({ logo: 'no-es-una-url' });

      expect(res.status).toBe(400);
      expect(prisma.business.update).not.toHaveBeenCalled();
    });

    it('persiste theme + hiddenSections vía el servicio de UI y los devuelve', async () => {
      mock(prisma.business.update).mockResolvedValue(businessRow);

      const res = await request(app)
        .patch('/api/whitelabel')
        .send({ theme: 'terra', hiddenSections: ['Arena', 'Marketplace'] });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ theme: 'terra', hiddenSections: ['Arena', 'Marketplace'] });
      expect(saveWhitelabelUi).toHaveBeenCalledWith('biz_1', {
        theme: 'terra',
        hiddenSections: ['Arena', 'Marketplace'],
      });
    });

    it('devuelve 400 con un theme fuera del enum (validacion Zod)', async () => {
      const res = await request(app).patch('/api/whitelabel').send({ theme: 'galactic' });

      expect(res.status).toBe(400);
      expect(saveWhitelabelUi).not.toHaveBeenCalled();
    });

    it('devuelve 400 con una sección inválida en hiddenSections', async () => {
      const res = await request(app).patch('/api/whitelabel').send({ hiddenSections: ['NoExiste'] });

      expect(res.status).toBe(400);
      expect(saveWhitelabelUi).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/whitelabel/preview', () => {
    it('devuelve el negocio con servicios activos y la URL de preview', async () => {
      mock(prisma.business.findUnique).mockResolvedValue({
        ...businessRow,
        services: [{ id: 'svc_1', isActive: true }],
      });

      const res = await request(app).get('/api/whitelabel/preview');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ previewUrl: 'https://localb.com/peluqueria-ana' });
      expect(res.body.business).toMatchObject({ id: 'biz_1' });
      expect(prisma.business.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'biz_1' },
          include: expect.objectContaining({ services: expect.anything() }),
        })
      );
    });

    it('usa "preview" en la URL cuando el negocio no existe', async () => {
      mock(prisma.business.findUnique).mockResolvedValue(null);

      const res = await request(app).get('/api/whitelabel/preview');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ business: null, previewUrl: 'https://localb.com/preview' });
    });
  });
});
