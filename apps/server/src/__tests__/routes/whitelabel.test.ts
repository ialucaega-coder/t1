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
    $queryRaw: vi.fn(),
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
    req.auth = { userId: 'user_1', businessId: 'biz_1', role: (req.headers['x-test-role'] as 'ADMIN' | 'PROFESSIONAL' | 'CLIENT' | undefined) ?? 'ADMIN' };
    next();
  },
  requireStaff: (req: Request, res: Response, next: NextFunction) => {
    if (req.auth?.role === 'CLIENT') {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
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
    mock(prisma.business.findFirst).mockResolvedValue(null); // por defecto, dominio libre
    mock(prisma.$queryRaw).mockResolvedValue([]); // por defecto, número libre
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

    describe('name (misma regla que el registro)', () => {
      const bidi = String.fromCharCode(0x202e);
      it.each([
        ['demasiado largo (>80)', 'a'.repeat(81)],
        ['con salto de línea', 'Banco\nAlerta'],
        ['con carácter bidi', 'Banco' + bidi + 'tfel'],
      ])('rechaza (400) un nombre %s y no escribe en la base', async (_label, name) => {
        const res = await request(app).patch('/api/whitelabel').send({ name });

        expect(res.status).toBe(400);
        expect(prisma.business.update).not.toHaveBeenCalled();
      });

      it('acepta un nombre normal', async () => {
        mock(prisma.business.update).mockResolvedValue({ ...businessRow, name: 'Peluquería Ana' });

        const res = await request(app).patch('/api/whitelabel').send({ name: 'Peluquería Ana' });

        expect(res.status).toBe(200);
      });
    });

    it('rechaza (409) un whatsappNumber ya usado por otro negocio', async () => {
      mock(prisma.$queryRaw).mockResolvedValue([{ id: 'otro_biz' }]); // número tomado
      const res = await request(app).patch('/api/whitelabel').send({ name: 'X', whatsappNumber: '+5491122223333' });
      expect(res.status).toBe(409);
      expect(prisma.business.update).not.toHaveBeenCalled();
    });

    it('rechaza (409) un phone ya usado por otro negocio', async () => {
      mock(prisma.$queryRaw).mockResolvedValue([{ id: 'otro_biz' }]);
      const res = await request(app).patch('/api/whitelabel').send({ phone: '+5491199998888' });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/ya está en uso/);
      expect(prisma.business.update).not.toHaveBeenCalled();
    });

    it('permite guardar un número libre y lo guarda en formato canónico (+dígitos)', async () => {
      mock(prisma.business.update).mockResolvedValue({ ...businessRow, whatsappNumber: '+5491122223333' });
      const res = await request(app).patch('/api/whitelabel').send({ name: 'X', whatsappNumber: '+54 9 11 2222-3333' });
      expect(res.status).toBe(200);
      expect(mock(prisma.business.update).mock.calls[0][0].data.whatsappNumber).toBe('+5491122223333');
    });

    it('el guard compara por DÍGITOS: "+54 9 11 …" y "+5491…" son el mismo número', async () => {
      await request(app).patch('/api/whitelabel').send({ phone: '+54 9 (11) 2222-3333', whatsappNumber: '5491144445555' });

      // $queryRaw es un template tag: (strings, businessId, dígitos, dígitos)
      const [, bizId, digits] = mock(prisma.$queryRaw).mock.calls[0];
      expect(bizId).toBe('biz_1');
      expect(digits).toEqual(['5491122223333', '5491144445555']);
      // Un advisory lock por número (en orden, sin deadlock).
      expect(mock(prisma.$executeRaw).mock.calls.map((c) => c[1])).toEqual(['biznum:5491122223333', 'biznum:5491144445555']);
      expect(mock(prisma.business.update).mock.calls[0][0].data).toMatchObject({ phone: '+5491122223333', whatsappNumber: '+5491144445555' });
    });

    it.each(['hola', '123', '+1234567890123456', '11 2222 33aa'])('rechaza (400) un número inválido ("%s") sin tocar la base', async (bad) => {
      const res = await request(app).patch('/api/whitelabel').send({ phone: bad });
      expect(res.status).toBe(400);
      expect(prisma.business.update).not.toHaveBeenCalled();
    });

    it('borrar el número (vacío/null) no dispara el guard y guarda null', async () => {
      mock(prisma.business.update).mockResolvedValue(businessRow);
      const res = await request(app).patch('/api/whitelabel').send({ phone: '', whatsappNumber: null });
      expect(res.status).toBe(200);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(mock(prisma.business.update).mock.calls[0][0].data).toMatchObject({ phone: null, whatsappNumber: null });
    });

    describe('validación de URLs, colores y dominio (M2)', () => {
      it.each([
        ['javascript:', 'javascript:alert(1)'],
        ['data:', 'data:image/svg+xml;base64,PHN2Zz4='],
        ['ftp:', 'ftp://x.com/logo.png'],
        ['http (no https)', 'http://x.com/logo.png'],
      ])('el logo rechaza %s', async (_l, logo) => {
        const res = await request(app).patch('/api/whitelabel').send({ logo });
        expect(res.status).toBe(400);
        expect(prisma.business.update).not.toHaveBeenCalled();
      });

      it.each(['instagramUrl', 'facebookUrl', 'websiteUrl'])('%s rechaza javascript:, data: y ftp:', async (field) => {
        for (const bad of ['javascript:alert(1)', 'data:text/html,hola', 'ftp://x.com']) {
          const res = await request(app).patch('/api/whitelabel').send({ [field]: bad });
          expect(res.status).toBe(400);
        }
        expect(prisma.business.update).not.toHaveBeenCalled();
      });

      it('acepta URLs https', async () => {
        mock(prisma.business.update).mockResolvedValue(businessRow);
        const res = await request(app).patch('/api/whitelabel').send({
          logo: 'https://cdn.x.com/logo.png', instagramUrl: 'https://instagram.com/ana', websiteUrl: 'https://ana.com',
        });
        expect(res.status).toBe(200);
      });

      it.each(['red', '#fff', '#GGGGGG', 'rgb(0,0,0)', 'url(javascript:x)'])('rechaza el color "%s"', async (color) => {
        for (const field of ['primaryColor', 'secondaryColor', 'accentColor']) {
          const res = await request(app).patch('/api/whitelabel').send({ [field]: color });
          expect(res.status).toBe(400);
        }
        expect(prisma.business.update).not.toHaveBeenCalled();
      });

      it('acepta #RRGGBB', async () => {
        mock(prisma.business.update).mockResolvedValue(businessRow);
        const res = await request(app).patch('/api/whitelabel').send({ primaryColor: '#A1b2C3' });
        expect(res.status).toBe(200);
      });

      it.each(['mi dominio.com', 'http://x.com', 'x.com/ruta', '-x.com', 'x', 'a..com', 'x.com:8080'])('rechaza el dominio "%s"', async (customDomain) => {
        const res = await request(app).patch('/api/whitelabel').send({ customDomain });
        expect(res.status).toBe(400);
        expect(prisma.business.update).not.toHaveBeenCalled();
      });

      it('guarda el dominio en minúsculas', async () => {
        mock(prisma.business.update).mockResolvedValue(businessRow);
        const res = await request(app).patch('/api/whitelabel').send({ customDomain: 'Reservas.MiNegocio.COM' });
        expect(res.status).toBe(200);
        expect(mock(prisma.business.update).mock.calls[0][0].data.customDomain).toBe('reservas.minegocio.com');
      });

      it('rechaza (409) un dominio que ya usa otro negocio, bajo lock', async () => {
        mock(prisma.business.findFirst).mockResolvedValue({ id: 'otro_biz' });
        const res = await request(app).patch('/api/whitelabel').send({ customDomain: 'reservas.otro.com' });
        expect(res.status).toBe(409);
        expect(res.body.error).toMatch(/dominio/);
        expect(mock(prisma.business.findFirst).mock.calls[0][0].where).toEqual({ id: { not: 'biz_1' }, customDomain: 'reservas.otro.com' });
        expect(mock(prisma.$executeRaw).mock.calls.map((c) => c[1])).toContain('bizdomain:reservas.otro.com');
        expect(prisma.business.update).not.toHaveBeenCalled();
      });

      it('borrar el dominio ("") guarda null sin consultar unicidad', async () => {
        mock(prisma.business.update).mockResolvedValue(businessRow);
        const res = await request(app).patch('/api/whitelabel').send({ customDomain: '' });
        expect(res.status).toBe(200);
        expect(prisma.business.findFirst).not.toHaveBeenCalled();
        expect(mock(prisma.business.update).mock.calls[0][0].data.customDomain).toBeNull();
      });
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
          select: expect.objectContaining({ services: expect.anything() }),
        })
      );
    });

    it('usa un select EXPLÍCITO: no pide (ni devuelve) campos internos como stripeCustomerId', async () => {
      mock(prisma.business.findUnique).mockResolvedValue({ ...businessRow, services: [] });

      await request(app).get('/api/whitelabel/preview');

      const args = mock(prisma.business.findUnique).mock.calls[0][0];
      expect(args.include).toBeUndefined();
      expect(args.select).toBeDefined();
      expect(args.select.stripeCustomerId).toBeUndefined();
      expect(Object.keys(args.select)).not.toContain('plan');
      expect(args.select.services.select).toBeDefined();
    });

    it('un CLIENT no puede ver la vista previa (403) y no se consulta la base', async () => {
      const res = await request(app).get('/api/whitelabel/preview').set('x-test-role', 'CLIENT');

      expect(res.status).toBe(403);
      expect(prisma.business.findUnique).not.toHaveBeenCalled();
    });

    it('un PROFESSIONAL (staff) sí puede', async () => {
      mock(prisma.business.findUnique).mockResolvedValue({ ...businessRow, services: [] });

      const res = await request(app).get('/api/whitelabel/preview').set('x-test-role', 'PROFESSIONAL');

      expect(res.status).toBe(200);
    });

    it('usa "preview" en la URL cuando el negocio no existe', async () => {
      mock(prisma.business.findUnique).mockResolvedValue(null);

      const res = await request(app).get('/api/whitelabel/preview');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ business: null, previewUrl: 'https://localb.com/preview' });
    });
  });
});
