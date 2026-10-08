import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { listClientsQuerySchema, updateClientSchema } from '../validators/clients';
import { toSkipTake } from '../validators/common';
import { parsePagination, buildPaginatedResponse } from '../lib/pagination';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
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

router.get(
  '/export/csv',
  requireAuth,
  asyncHandler(async (req, res) => {
    const clients = await prisma.user.findMany({
      where: {
        businessId: req.auth!.businessId,
        role: 'CLIENT',
        deletedAt: null,
      },
      select: {
        name: true,
        email: true,
        phone: true,
        createdAt: true,
        bookingsAsClient: {
          orderBy: { date: 'desc' },
          take: 1,
          select: { date: true },
        },
        _count: { select: { bookingsAsClient: true, orders: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const header = 'Nombre,Email,Teléfono,Reservas,Órdenes,Última visita,Registrado\n';
    const rows = clients.map((c) => {
      const lastVisit = c.bookingsAsClient[0]?.date
        ? new Date(c.bookingsAsClient[0].date).toISOString().split('T')[0]
        : '';
      return [
        `"${c.name.replace(/"/g, '""')}"`,
        c.email,
        c.phone || '',
        c._count.bookingsAsClient,
        c._count.orders,
        lastVisit,
        new Date(c.createdAt).toISOString().split('T')[0],
      ].join(',');
    }).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="clientes.csv"');
    res.send('﻿' + header + rows);
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

    // Adjunta la anotación del CRM (etiquetas asignadas + nota interna).
    const crm = await loadClientCrm(req.auth!.businessId);
    const annotation = crm.byClient[client.id] ?? { tags: [], note: '' };
    res.json({ ...client, tags: annotation.tags, note: annotation.note });
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

    const existing = await prisma.user.findFirst({
      where: {
        email: data.email,
        businessId: req.auth!.businessId,
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
    const tempPassword = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);

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
