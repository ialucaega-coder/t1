import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { listClientsQuerySchema, updateClientSchema } from '../validators/clients';
import { toSkipTake } from '../validators/common';
import { z } from 'zod';
import bcrypt from 'bcryptjs';

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
    const where: any = {
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
      data: clients,
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
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

    res.json(client);
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

    const tempPassword = await bcrypt.hash('client_' + Date.now(), 12);

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
