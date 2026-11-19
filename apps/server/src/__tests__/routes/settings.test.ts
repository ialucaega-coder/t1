/**
 * Pruebas de integracion para las rutas de configuracion
 * (`src/routes/settings.ts`): lectura de settings del negocio (scope por
 * businessId) y actualizacion (200 + validacion 400). La configuracion de IA
 * ya no vive aca (se movio al Motor de IA real en /api/ai); ver ai.test.ts.
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
      update: vi.fn(),
    },
    connection: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
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
import { settingsRouter } from '../../routes/settings';
import { errorHandler } from '../../middleware/errorHandler';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/settings', settingsRouter);
  app.use(errorHandler);
  return app;
}

const businessRow = {
  id: 'biz_1',
  name: 'Peluqueria Ana',
  slug: 'peluqueria-ana',
  phone: null,
  email: null,
  address: null,
  timezone: 'America/Argentina/Buenos_Aires',
  currency: 'ARS',
  theme: 'light',
  accentColor: '#3366FF',
};

describe('routes/settings', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    // El PUT guarda dentro de una transacción (guard anti-hijack de teléfono).
    mock(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
    mock(prisma.$executeRaw).mockResolvedValue(0);
    mock(prisma.$queryRaw).mockResolvedValue([]); // por defecto, número libre
  });

  describe('GET /api/settings', () => {
    it('devuelve la configuracion mapeada del negocio (scope por businessId)', async () => {
      mock(prisma.business.findUnique).mockResolvedValue(businessRow);

      const res = await request(app).get('/api/settings');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        businessName: 'Peluqueria Ana',
        slug: 'peluqueria-ana',
        currency: 'ARS',
      });
      expect(prisma.business.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'biz_1' } })
      );
    });

    it('devuelve 404 si el negocio no existe', async () => {
      mock(prisma.business.findUnique).mockResolvedValue(null);

      const res = await request(app).get('/api/settings');

      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/settings', () => {
    it('actualiza los settings del negocio (scope por businessId)', async () => {
      mock(prisma.business.update).mockResolvedValue({ ...businessRow, name: 'Nuevo Nombre' });

      const res = await request(app).put('/api/settings').send({ businessName: 'Nuevo Nombre' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ businessName: 'Nuevo Nombre' });
      expect(prisma.business.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'biz_1' },
          data: expect.objectContaining({ name: 'Nuevo Nombre' }),
        })
      );
    });

    describe('teléfono: guard anti-hijack compartido con white label (A3)', () => {
      it('rechaza (409) un teléfono que ya usa otro negocio y no escribe', async () => {
        mock(prisma.$queryRaw).mockResolvedValue([{ id: 'otro_biz' }]);

        const res = await request(app).put('/api/settings').send({ phone: '+5491123456789' });

        expect(res.status).toBe(409);
        expect(res.body.error).toMatch(/ya está en uso/);
        expect(prisma.business.update).not.toHaveBeenCalled();
      });

      it('lo guarda en formato canónico y compara por dígitos con lock', async () => {
        mock(prisma.business.update).mockResolvedValue({ ...businessRow, phone: '+5491123456789' });

        const res = await request(app).put('/api/settings').send({ phone: '+54 9 11 2345-6789' });

        expect(res.status).toBe(200);
        expect(mock(prisma.business.update).mock.calls[0][0].data.phone).toBe('+5491123456789');
        const [, bizId, digits] = mock(prisma.$queryRaw).mock.calls[0];
        expect(bizId).toBe('biz_1');
        expect(digits).toEqual(['5491123456789']);
        expect(mock(prisma.$executeRaw).mock.calls[0][1]).toBe('biznum:5491123456789');
      });

      it('"+54 9 11 …" y "+5491…" colisionan: ambos formatos pasan por la MISMA comparación de dígitos', async () => {
        mock(prisma.business.update).mockResolvedValue(businessRow);

        await request(app).put('/api/settings').send({ phone: '+54 9 11 2345-6789' });
        await request(app).put('/api/settings').send({ phone: '+5491123456789' });

        const digitArgs = mock(prisma.$queryRaw).mock.calls.map((c) => c[2]);
        expect(digitArgs[0]).toEqual(digitArgs[1]);
      });

      it('un teléfono inválido da 400 sin tocar la base', async () => {
        const res = await request(app).put('/api/settings').send({ phone: 'llamame' });

        expect(res.status).toBe(400);
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(prisma.business.update).not.toHaveBeenCalled();
      });

      it('vaciar el teléfono guarda null sin ejecutar el guard', async () => {
        mock(prisma.business.update).mockResolvedValue(businessRow);

        const res = await request(app).put('/api/settings').send({ phone: '' });

        expect(res.status).toBe(200);
        expect(prisma.$queryRaw).not.toHaveBeenCalled();
        expect(mock(prisma.business.update).mock.calls[0][0].data.phone).toBeNull();
      });

      it('si no viene phone no se toca ni se consulta el guard', async () => {
        mock(prisma.business.update).mockResolvedValue(businessRow);

        await request(app).put('/api/settings').send({ address: 'Calle 1' });

        expect(prisma.$queryRaw).not.toHaveBeenCalled();
        expect(mock(prisma.business.update).mock.calls[0][0].data.phone).toBeUndefined();
      });
    });

    describe('moneda, zona horaria y slug (M10)', () => {
      it('normaliza la moneda a mayúsculas', async () => {
        mock(prisma.business.update).mockResolvedValue(businessRow);

        const res = await request(app).put('/api/settings').send({ currency: 'usd' });

        expect(res.status).toBe(200);
        expect(mock(prisma.business.update).mock.calls[0][0].data.currency).toBe('USD');
      });

      it.each(['PESO', 'AR', '123', 'A$S', 'ZZZ'])('rechaza la moneda "%s"', async (currency) => {
        const res = await request(app).put('/api/settings').send({ currency });
        expect(res.status).toBe(400);
        expect(prisma.business.update).not.toHaveBeenCalled();
      });

      it('acepta una zona horaria IANA válida', async () => {
        mock(prisma.business.update).mockResolvedValue(businessRow);
        const res = await request(app).put('/api/settings').send({ timezone: 'America/Argentina/Buenos_Aires' });
        expect(res.status).toBe(200);
      });

      it.each(['Mars/Olympus', 'GMT+99', 'hola', '../../etc/passwd'])('rechaza la zona horaria "%s"', async (timezone) => {
        const res = await request(app).put('/api/settings').send({ timezone });
        expect(res.status).toBe(400);
        expect(prisma.business.update).not.toHaveBeenCalled();
      });

      it.each(['api', 'admin', 'www', 'app', 'dashboard', 'login', 'register'])('rechaza el slug reservado "%s"', async (slug) => {
        const res = await request(app).put('/api/settings').send({ slug });
        expect(res.status).toBe(400);
        expect(prisma.business.update).not.toHaveBeenCalled();
      });

      it('un slug normal sigue funcionando (y uno que empieza con una palabra reservada también)', async () => {
        mock(prisma.business.update).mockResolvedValue(businessRow);
        const res = await request(app).put('/api/settings').send({ slug: 'admin-peluqueria' });
        expect(res.status).toBe(200);
      });
    });

    describe('businessName (misma regla que el registro)', () => {
      const bidi = String.fromCharCode(0x202e);
      it.each([
        ['demasiado largo (>80)', 'a'.repeat(81)],
        ['con salto de línea', 'Banco\nBcc: x@y.com'],
        ['con carácter bidi', 'Banco' + bidi + 'tfel'],
        ['con ancho cero', 'Ban' + String.fromCharCode(0x200b) + 'co'],
      ])('rechaza (400) un nombre %s y no escribe en la base', async (_label, businessName) => {
        const res = await request(app).put('/api/settings').send({ businessName });

        expect(res.status).toBe(400);
        expect(prisma.business.update).not.toHaveBeenCalled();
      });

      it('acepta un nombre normal y lo guarda recortado', async () => {
        mock(prisma.business.update).mockResolvedValue({ ...businessRow, name: "Peluquería D'Sol" });

        const res = await request(app).put('/api/settings').send({ businessName: "  Peluquería D'Sol  " });

        expect(res.status).toBe(200);
        expect(prisma.business.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ name: "Peluquería D'Sol" }) })
        );
      });
    });

    it('devuelve 400 con un slug invalido (validacion Zod)', async () => {
      const res = await request(app).put('/api/settings').send({ slug: 'Slug Invalido!' });

      expect(res.status).toBe(400);
      expect(prisma.business.update).not.toHaveBeenCalled();
    });
  });
});
