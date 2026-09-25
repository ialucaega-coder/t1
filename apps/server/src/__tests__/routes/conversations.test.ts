/**
 * Pruebas de integración para el Inbox unificado
 * (`src/routes/conversations.ts`): asignación, etiquetas, notas internas y
 * lectura por usuario — todo persistido en Conversation.metadata (Json) sin
 * tocar el schema de Prisma.
 *
 * Auth REAL (JWT). Se mockea Prisma y `lib/socket` (getIO → null, así el
 * emit por WebSocket se omite de forma segura).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    conversation: { findFirst: vi.fn(), update: vi.fn() },
    teamMember: { findFirst: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

vi.mock('../../lib/socket', () => ({
  getIO: vi.fn(() => null),
}));

import { prisma } from '../../lib/prisma';
import { conversationsRouter } from '../../routes/conversations';
import { errorHandler } from '../../middleware/errorHandler';

const JWT_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret';
const token = jwt.sign({ userId: 'user_1', businessId: 'biz_1', role: 'ADMIN' }, JWT_SECRET);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/conversations', conversationsRouter);
  app.use(errorHandler);
  return app;
}

/** Captura el metadata que la ruta manda a prisma.conversation.update. */
function updatedMeta(): Record<string, unknown> {
  const call = (prisma.conversation.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
  return call.data.metadata;
}

describe('routes/conversations (inbox)', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    // La ruta devuelve updated.metadata; devolvemos lo que se le pasó.
    (prisma.conversation.update as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ data }: { data: { metadata: unknown } }) => ({ metadata: data.metadata })
    );
  });

  describe('PATCH /api/conversations/:id/assign', () => {
    it('asigna la conversación a un miembro del equipo existente', async () => {
      (prisma.conversation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'c1', businessId: 'biz_1', metadata: {} });
      (prisma.teamMember.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'm1', name: 'Sofía' });

      const res = await request(app)
        .patch('/api/conversations/c1/assign')
        .set('Authorization', `Bearer ${token}`)
        .send({ assignedTo: 'm1' });

      expect(res.status).toBe(200);
      expect(updatedMeta()).toMatchObject({ assignedTo: 'm1', assignedToName: 'Sofía' });
    });

    it('desasigna cuando assignedTo es null', async () => {
      (prisma.conversation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'c1', businessId: 'biz_1', metadata: { assignedTo: 'm1', assignedToName: 'Sofía' },
      });

      const res = await request(app)
        .patch('/api/conversations/c1/assign')
        .set('Authorization', `Bearer ${token}`)
        .send({ assignedTo: null });

      expect(res.status).toBe(200);
      expect(updatedMeta()).toMatchObject({ assignedTo: null, assignedToName: null });
      expect(prisma.teamMember.findFirst).not.toHaveBeenCalled();
    });

    it('devuelve 404 si el miembro del equipo no existe', async () => {
      (prisma.conversation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'c1', businessId: 'biz_1', metadata: {} });
      (prisma.teamMember.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await request(app)
        .patch('/api/conversations/c1/assign')
        .set('Authorization', `Bearer ${token}`)
        .send({ assignedTo: 'inexistente' });

      expect(res.status).toBe(404);
      expect(prisma.conversation.update).not.toHaveBeenCalled();
    });

    it('devuelve 404 si la conversación no existe', async () => {
      (prisma.conversation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await request(app)
        .patch('/api/conversations/nope/assign')
        .set('Authorization', `Bearer ${token}`)
        .send({ assignedTo: 'm1' });

      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/conversations/:id/tags', () => {
    it('normaliza etiquetas: recorta, elimina vacías y duplicados (case-insensitive)', async () => {
      (prisma.conversation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'c1', businessId: 'biz_1', metadata: {} });

      const res = await request(app)
        .patch('/api/conversations/c1/tags')
        .set('Authorization', `Bearer ${token}`)
        .send({ tags: ['  VIP ', 'vip', 'urgente', 'Urgente'] });

      expect(res.status).toBe(200);
      expect(updatedMeta().tags).toEqual(['VIP', 'urgente']);
    });

    it('devuelve 400 si tags no es un arreglo válido', async () => {
      const res = await request(app)
        .patch('/api/conversations/c1/tags')
        .set('Authorization', `Bearer ${token}`)
        .send({ tags: 'no-es-array' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/conversations/:id/notes', () => {
    it('agrega una nota interna con autor', async () => {
      (prisma.conversation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'c1', businessId: 'biz_1', metadata: {} });
      (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ name: 'Luca' });

      const res = await request(app)
        .post('/api/conversations/c1/notes')
        .set('Authorization', `Bearer ${token}`)
        .send({ text: '  Cliente pidió factura A  ' });

      expect(res.status).toBe(200);
      expect(res.body.note).toMatchObject({ text: 'Cliente pidió factura A', by: 'user_1', byName: 'Luca' });
      const notes = updatedMeta().notes as unknown[];
      expect(notes).toHaveLength(1);
    });

    it('respeta el tope máximo de notas (MAX_NOTES=200)', async () => {
      const existentes = Array.from({ length: 200 }, (_, i) => ({ text: `n${i}`, at: '', by: 'x' }));
      (prisma.conversation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'c1', businessId: 'biz_1', metadata: { notes: existentes },
      });
      (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ name: 'Luca' });

      const res = await request(app)
        .post('/api/conversations/c1/notes')
        .set('Authorization', `Bearer ${token}`)
        .send({ text: 'la 201' });

      expect(res.status).toBe(200);
      const notes = updatedMeta().notes as { text: string }[];
      expect(notes).toHaveLength(200);
      // La más vieja se descartó y la nueva quedó al final.
      expect(notes[notes.length - 1].text).toBe('la 201');
      expect(notes[0].text).toBe('n1');
    });
  });

  describe('PATCH /api/conversations/:id/read', () => {
    it('marca la lectura por usuario (readBy[userId]) sin pisar la de otros', async () => {
      (prisma.conversation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'c1', businessId: 'biz_1', metadata: { readBy: { user_2: '2026-01-01T00:00:00.000Z' } },
      });

      const res = await request(app)
        .patch('/api/conversations/c1/read')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      const readBy = updatedMeta().readBy as Record<string, string>;
      expect(readBy.user_2).toBe('2026-01-01T00:00:00.000Z'); // intacta
      expect(readBy.user_1).toBeTruthy(); // la del usuario actual
    });
  });
});
