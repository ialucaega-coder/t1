/**
 * Pruebas de los generadores de superpoderes "fuera del prompt"
 * (services/superpowers/report.ts). Fijan la matemática de ventanas de fecha
 * (hoy / mañana / ayer) y el texto de los mensajes, mockeando Prisma.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    conversation: { count: vi.fn(async () => 0) },
    message: { count: vi.fn(async () => 0) },
    booking: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
    business: { findUnique: vi.fn(async () => ({ name: 'Barbería Central' })) },
  },
}));

import { prisma } from '../../lib/prisma';
import {
  generateDailyReport,
  generateReminders,
  generateNoShowRecovery,
  generatePostSaleFollowUps,
} from '../../services/superpowers/report';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

/** Inicio de día local para `date`, +offsetDays. */
function startOfDay(date: Date, offsetDays = 0): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + offsetDays);
  d.setHours(0, 0, 0, 0);
  return d;
}

const REF = new Date('2026-09-26T12:00:00'); // referencia local fija

describe('services/superpowers/report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock(prisma.business.findUnique).mockResolvedValue({ name: 'Barbería Central' });
  });

  describe('generateDailyReport', () => {
    it('cuenta sobre la ventana de HOY y arma el texto del resumen', async () => {
      mock(prisma.conversation.count)
        .mockResolvedValueOnce(3) // newConversations (createdAt)
        .mockResolvedValueOnce(10) // activeConversations (updatedAt)
        .mockResolvedValueOnce(2); // handoffs
      mock(prisma.message.count).mockResolvedValue(42);
      mock(prisma.booking.count).mockResolvedValue(5);

      const report = await generateDailyReport('biz_1', REF);

      expect(report).toMatchObject({
        businessId: 'biz_1',
        conversations: 10,
        newConversations: 3,
        messages: 42,
        bookings: 5,
        handoffs: 2,
      });
      expect(report.text).toContain('Conversaciones activas: 10 (3 nuevas)');
      expect(report.text).toContain('Reservas generadas: 5');

      // La primera query (newConversations) usa la ventana de HOY.
      const whereArg = mock(prisma.conversation.count).mock.calls[0][0].where;
      expect(whereArg.createdAt.gte.getTime()).toBe(startOfDay(REF).getTime());
      expect(whereArg.createdAt.lt.getTime()).toBe(startOfDay(REF, 1).getTime());
    });
  });

  describe('generateReminders', () => {
    it('busca reservas de MAÑANA (PENDING/CONFIRMED) y arma el recordatorio', async () => {
      mock(prisma.booking.findMany).mockResolvedValue([
        { id: 'b1', startTime: '15:00', client: { name: 'Ana' }, service: { name: 'Corte' } },
      ]);

      const reminders = await generateReminders('biz_1', REF);

      expect(reminders).toHaveLength(1);
      expect(reminders[0]).toMatchObject({ bookingId: 'b1', clientName: 'Ana', time: '15:00', service: 'Corte' });
      expect(reminders[0].text).toContain('Ana');
      expect(reminders[0].text).toContain('Barbería Central');
      expect(reminders[0].text).toContain('15:00');

      const whereArg = mock(prisma.booking.findMany).mock.calls[0][0].where;
      // Ventana = mañana (REF + 1 día).
      expect(whereArg.date.gte.getTime()).toBe(startOfDay(REF, 1).getTime());
      expect(whereArg.date.lt.getTime()).toBe(startOfDay(REF, 2).getTime());
      expect(whereArg.status).toEqual({ in: ['PENDING', 'CONFIRMED'] });
    });

    it('devuelve lista vacía cuando no hay reservas para mañana', async () => {
      mock(prisma.booking.findMany).mockResolvedValue([]);
      expect(await generateReminders('biz_1', REF)).toEqual([]);
    });
  });

  describe('generateNoShowRecovery', () => {
    it('busca NO_SHOW de HOY (por updatedAt) y arma el mensaje de recuperación', async () => {
      mock(prisma.booking.findMany).mockResolvedValue([
        { id: 'b2', client: { name: 'Leo' }, service: { name: 'Color' } },
      ]);

      const items = await generateNoShowRecovery('biz_1', REF);

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ bookingId: 'b2', clientName: 'Leo', service: 'Color' });
      const whereArg = mock(prisma.booking.findMany).mock.calls[0][0].where;
      expect(whereArg.status).toBe('NO_SHOW');
      expect(whereArg.updatedAt.gte.getTime()).toBe(startOfDay(REF).getTime());
      expect(whereArg.updatedAt.lt.getTime()).toBe(startOfDay(REF, 1).getTime());
    });
  });

  describe('generatePostSaleFollowUps', () => {
    it('busca COMPLETED de AYER (por date) y arma el seguimiento', async () => {
      mock(prisma.booking.findMany).mockResolvedValue([
        { id: 'b3', client: { name: 'Sol' }, service: { name: 'Manicura' } },
      ]);

      const items = await generatePostSaleFollowUps('biz_1', REF);

      expect(items).toHaveLength(1);
      expect(items[0].text).toContain('Sol');
      expect(items[0].text).toContain('Manicura');
      const whereArg = mock(prisma.booking.findMany).mock.calls[0][0].where;
      expect(whereArg.status).toBe('COMPLETED');
      // Ventana = ayer (REF - 1 día).
      expect(whereArg.date.gte.getTime()).toBe(startOfDay(REF, -1).getTime());
      expect(whereArg.date.lt.getTime()).toBe(startOfDay(REF).getTime());
    });
  });
});
