import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { listClientsQuerySchema, updateClientSchema } from '../validators/clients';
import { toSkipTake } from '../validators/common';
import { parsePagination, buildPaginatedResponse } from '../lib/pagination';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import crypto from 'crypto';
import { hashPassword } from '../lib/password';
import { getContactCapacity } from '../services/billing/limits';
import {
  loadClientCrm,
  saveTags,
  setClientTags,
  setClientNote,
  MAX_TAGS,
  MAX_TAG_LABEL_LEN,
  MAX_NOTE_LEN,
  MAX_TAGS_PER_CLIENT,
  TAG_COLORS,
} from '../services/clients/crm';
import {
  loadLifecycle,
  setClientStage,
  getFunnel,
  stageFor,
  LIFECYCLE_STAGES,
} from '../services/clients/lifecycle';
import { dispatchEvent } from '../services/workflows';

const router = Router();

const clientSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  avatar: true,
  isActive: true,
  createdAt: true,
  lastLoginAt: true,
  bookingsAsClient: {
    orderBy: { date: 'desc' as const },
    take: 1,
    select: { date: true },
  },
  _count: { select: { bookingsAsClient: true, orders: true } },
};

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = listClientsQuerySchema.parse(req.query);
    const where: Prisma.UserWhereInput = {
      businessId: req.auth!.businessId,
      role: 'CLIENT',
      deletedAt: null,
    };

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search } },
      ];
    }

    // CRM (etiquetas + notas) del negocio. Se usa para (a) filtrar por etiqueta
    // y (b) adjuntar las etiquetas de cada cliente a la respuesta.
    const crm = await loadClientCrm(req.auth!.businessId);

    // Etapa del ciclo de vida (embudo CRM) de cada cliente. Default 'NEW'.
    const lifecycle = await loadLifecycle(req.auth!.businessId);

    // Filtro por etiqueta: restringimos los ids ANTES de la query para que la
    // paginación y el total sean correctos (no post-filtramos la página).
    if (query.tagId) {
      const taggedIds = Object.entries(crm.byClient)
        .filter(([, a]) => a.tags.includes(query.tagId as string))
        .map(([id]) => id);
      where.id = { in: taggedIds };
    }

    const withTags = <T extends { id: string }>(client: T) => ({
      ...client,
      tags: crm.byClient[client.id]?.tags ?? [],
      stage: stageFor(lifecycle, client.id),
    });

    // Nueva paginación (?limit / ?offset): devuelve la forma estándar { ...limit... }.
    // No usamos ?page como disparador para no cambiar la respuesta actual, que ya
    // usa ?page + ?pageSize y expone `pageSize`.
    if (req.query.limit !== undefined || req.query.offset !== undefined) {
      const pagination = parsePagination(req.query);
      const [clients, total] = await Promise.all([
        prisma.user.findMany({
          where,
          select: clientSelect,
          orderBy: { createdAt: 'desc' },
          skip: pagination.skip,
          take: pagination.take,
        }),
        prisma.user.count({ where }),
      ]);
      return res.json(buildPaginatedResponse(clients.map(withTags), total, pagination));
    }

    const [clients, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: clientSelect,
        orderBy: { createdAt: 'desc' },
        ...toSkipTake(query),
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      data: clients.map(withTags),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
      // Catálogo de etiquetas del negocio (para pintar chips y poblar el filtro).
      tagCatalog: crm.tags,
    });
  })
);

/** Tamaño de lote del export en streaming (acota memoria, independiente del total). */
const CSV_EXPORT_BATCH = 500;

/**
 * Escapa un valor para una celda CSV:
 * - Envuelve en comillas y duplica las comillas internas (RFC 4180).
 * - Previene inyección de fórmulas (CSV injection): si el valor empieza con
 *   `= + - @` o un control de tab/CR, le antepone una comilla simple para que
 *   Excel/Sheets no lo ejecute como fórmula.
 */
function csvCell(value: string | number | null | undefined): string {
  const raw = value == null ? '' : String(value);
  const guarded = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${guarded.replace(/"/g, '""')}"`;
}

router.get(
  '/export/csv',
  requireAuth,
  asyncHandler(async (req, res) => {
    const businessId = req.auth!.businessId;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="clientes.csv"');
    // BOM para que Excel detecte UTF-8 + cabecera.
    res.write('﻿' + 'Nombre,Email,Teléfono,Reservas,Órdenes,Última visita,Registrado\n');

    // Antes: un findMany sin `take` cargaba TODOS los clientes a memoria y armaba
    // un string gigante (riesgo de OOM con decenas de miles de registros). Ahora
    // paginamos por cursor y escribimos cada lote al response en streaming. El
    // orderBy incluye `id` como desempate para que el cursor sea determinista.
    let cursor: string | undefined;
    for (;;) {
      // Si el cliente cortó la descarga, dejamos de consultar la BD (no tiene
      // sentido paginar para una respuesta que ya nadie recibe).
      if (res.writableEnded || res.destroyed) return;

      const batch = await prisma.user.findMany({
        where: { businessId, role: 'CLIENT', deletedAt: null },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          createdAt: true,
          bookingsAsClient: { orderBy: { date: 'desc' }, take: 1, select: { date: true } },
          _count: { select: { bookingsAsClient: true, orders: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: CSV_EXPORT_BATCH,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });

      if (batch.length === 0) break;

      const chunk = batch
        .map((c) => {
          const lastVisit = c.bookingsAsClient[0]?.date
            ? new Date(c.bookingsAsClient[0].date).toISOString().split('T')[0]
            : '';
          return [
            csvCell(c.name),
            csvCell(c.email),
            csvCell(c.phone || ''),
            c._count.bookingsAsClient,
            c._count.orders,
            lastVisit,
            new Date(c.createdAt).toISOString().split('T')[0],
          ].join(',');
        })
        .join('\n');
      res.write(chunk + '\n');

      if (batch.length < CSV_EXPORT_BATCH) break;
      cursor = batch[batch.length - 1].id;
    }

    res.end();
  })
);

// --- CRM: catálogo de etiquetas + notas por cliente (respond.io / SalesMartly) ---

/** GET /api/clients/crm → catálogo de etiquetas + todas las anotaciones del negocio. */
router.get(
  '/crm',
  requireAuth,
  asyncHandler(async (req, res) => {
    const crm = await loadClientCrm(req.auth!.businessId);
    res.json(crm);
  })
);

/**
 * GET /api/clients/funnel → conteo de clientes por etapa del ciclo de vida
 * (embudo CRM). Scope multi-tenant por businessId. Debe declararse ANTES de
 * `/:id` para que no lo capture esa ruta.
 */
router.get(
  '/funnel',
  requireAuth,
  asyncHandler(async (req, res) => {
    const funnel = await getFunnel(req.auth!.businessId);
    res.json(funnel);
  })
);

const tagColorEnum = z.enum(TAG_COLORS);
const saveTagsSchema = z.object({
  tags: z
    .array(
      z.object({
        id: z.string().max(64).optional(),
        label: z.string().min(1).max(MAX_TAG_LABEL_LEN),
        color: tagColorEnum.optional(),
      })
    )
    .max(MAX_TAGS),
});

/** PUT /api/clients/crm/tags → reemplaza el catálogo de etiquetas (solo staff). */
router.put(
  '/crm/tags',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = saveTagsSchema.parse(req.body);
    const crm = await saveTags(req.auth!.businessId, data.tags);
    res.json(crm);
  })
);

const setClientTagsSchema = z.object({
  tags: z.array(z.string().max(64)).max(MAX_TAGS_PER_CLIENT),
});
const setClientNoteSchema = z.object({
  note: z.string().max(MAX_NOTE_LEN),
});

/** Verifica que el cliente exista y sea del negocio (scope multi-tenant). */
async function assertClientInBusiness(businessId: string, clientId: string): Promise<boolean> {
  const client = await prisma.user.findFirst({
    where: { id: clientId, businessId, role: 'CLIENT', deletedAt: null },
    select: { id: true },
  });
  return Boolean(client);
}

/** PUT /api/clients/:id/tags → setea las etiquetas de un cliente. */
router.put(
  '/:id/tags',
  requireAuth,
  asyncHandler(async (req, res) => {
    const clientId = req.params.id as string;
    const data = setClientTagsSchema.parse(req.body);
    if (!(await assertClientInBusiness(req.auth!.businessId, clientId))) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }
    const annotation = await setClientTags(req.auth!.businessId, clientId, data.tags);
    res.json(annotation);
  })
);

/** PUT /api/clients/:id/note → setea la nota interna de un cliente. */
router.put(
  '/:id/note',
  requireAuth,
  asyncHandler(async (req, res) => {
    const clientId = req.params.id as string;
    const data = setClientNoteSchema.parse(req.body);
    if (!(await assertClientInBusiness(req.auth!.businessId, clientId))) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }
    const annotation = await setClientNote(req.auth!.businessId, clientId, data.note);
    res.json(annotation);
  })
);

const setLifecycleSchema = z.object({
  stage: z.enum(LIFECYCLE_STAGES),
});

/** PATCH /api/clients/:id/lifecycle → mueve al cliente de etapa en el embudo. */
router.patch(
  '/:id/lifecycle',
  requireAuth,
  asyncHandler(async (req, res) => {
    const clientId = req.params.id as string;
    const data = setLifecycleSchema.parse(req.body);
    if (!(await assertClientInBusiness(req.auth!.businessId, clientId))) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }
    const stage = await setClientStage(req.auth!.businessId, clientId, data.stage);
    res.json({ stage });
  })
);

router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const client = await prisma.user.findFirst({
      where: {
        id: req.params.id as string,
        businessId: req.auth!.businessId,
        role: 'CLIENT',
        deletedAt: null,
      },
      select: {
        ...clientSelect,
        bookingsAsClient: {
          orderBy: { date: 'desc' },
          take: 10,
          select: {
            id: true,
            date: true,
            startTime: true,
            status: true,
            service: { select: { name: true } },
          },
        },
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            totalPrice: true,
            status: true,
            createdAt: true,
          },
        },
        notifications: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            type: true,
            title: true,
            body: true,
            isRead: true,
            createdAt: true,
          },
        },
      },
    });

    if (!client) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    // Adjunta la anotación del CRM (etiquetas asignadas + nota interna) y la
    // etapa del ciclo de vida (embudo).
    const crm = await loadClientCrm(req.auth!.businessId);
    const annotation = crm.byClient[client.id] ?? { tags: [], note: '' };
    const lifecycle = await loadLifecycle(req.auth!.businessId);
    res.json({
      ...client,
      tags: annotation.tags,
      note: annotation.note,
      stage: stageFor(lifecycle, client.id),
    });
  })
);

const createClientSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().optional(),
});

router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = createClientSchema.parse(req.body);
    const businessId = req.auth!.businessId;

    // Enforcement del plan: no superar el `maxContacts` del plan (antes solo se
    // mostraba el límite). Mismo patrón que maxBots/maxMessages.
    const cap = await getContactCapacity(businessId);
    if (cap.atLimit) {
      return res.status(403).json({
        error: `Alcanzaste el límite de contactos de tu plan (${cap.limit}). Mejorá tu plan para agregar más.`,
        code: 'PLAN_LIMIT_REACHED',
        limit: cap.limit,
        used: cap.used,
      });
    }

    const existing = await prisma.user.findFirst({
      where: {
        email: data.email,
        businessId,
        deletedAt: null,
      },
    });

    if (existing) {
      return res.status(409).json({ error: 'Ya existe un cliente con ese email' });
    }

    // Password aleatorio e imposible de adivinar. Antes era `'client_' + Date.now()`,
    // cuyo valor es predecible (timestamp acotado): un atacante podía fijar la
    // contraseña de un cliente recién creado y loguearse con rol CLIENT. Estos
    // clientes se crean para el portal/reservas y no fijan su propia clave acá.
    const tempPassword = await hashPassword(crypto.randomBytes(32).toString('hex'));

    const client = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone || null,
        passwordHash: tempPassword,
        role: 'CLIENT',
        businessId: req.auth!.businessId,
      },
      select: clientSelect,
    });

    // Dispara las automatizaciones de "lead nuevo". Fire-and-forget: el modo lo
    // resuelve dispatchEvent según el ajuste del negocio y nunca lanza.
    void dispatchEvent(req.auth!.businessId, {
      trigger: 'lead_nuevo',
      payload: { clientId: client.id, phone: data.phone || undefined },
    });

    res.status(201).json(client);
  })
);

router.patch(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = updateClientSchema.parse(req.body);

    const client = await prisma.user.findFirst({
      where: {
        id: req.params.id as string,
        businessId: req.auth!.businessId,
        role: 'CLIENT',
        deletedAt: null,
      },
    });

    if (!client) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    const updated = await prisma.user.update({
      where: { id: req.params.id as string },
      data,
      select: clientSelect,
    });

    res.json(updated);
  })
);

router.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const client = await prisma.user.findFirst({
      where: {
        id: req.params.id as string,
        businessId: req.auth!.businessId,
        role: 'CLIENT',
        deletedAt: null,
      },
    });

    if (!client) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    await prisma.user.update({
      where: { id: req.params.id as string },
      data: { deletedAt: new Date() },
    });

    res.json({ success: true });
  })
);

export { router as clientsRouter };
