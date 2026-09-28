/**
 * Pruebas del scheduler de superpoderes (services/scheduler.ts): los jobs
 * "fuera del prompt" que corren una vez al día.
 *
 * Verifica que cada job (a) elija sólo negocios activos con el superpoder
 * activo cuyo config sea de tipo "superpower", (b) salte los negocios sin
 * ADMIN, (c) no notifique cuando no hay nada que reportar, y (d) aísle el
 * error de un negocio para no frenar al resto.
 *
 * node-cron se mockea (no se programan cron reales). Prisma y el generador de
 * reportes también se mockean.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));

vi.mock('../../lib/prisma', () => ({
  prisma: {
    skill: { findMany: vi.fn() },
    user: { findFirst: vi.fn() },
    notification: { create: vi.fn() },
  },
}));

vi.mock('../../services/superpowers/report', () => ({
  generateDailyReport: vi.fn(),
  generateReminders: vi.fn(),
  generateNoShowRecovery: vi.fn(),
  generatePostSaleFollowUps: vi.fn(),
}));

import cron from 'node-cron';
import { prisma } from '../../lib/prisma';
import {
  generateDailyReport,
  generateReminders,
} from '../../services/superpowers/report';
import { runDailyReports, runReminders, startScheduler } from '../../services/scheduler';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

/** skill.findMany devuelve filas con config; sólo las de kind==='superpower' cuentan. */
function skillRow(businessId: string, kind: string = 'superpower') {
  return { businessId, config: { kind } };
}
/** Fila cuyo config es null (skill que no es un superpoder). */
function skillRowNoConfig(businessId: string) {
  return { businessId, config: null };
}

describe('services/scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock(prisma.user.findFirst).mockResolvedValue({ id: 'admin_1' });
    mock(prisma.notification.create).mockResolvedValue({ id: 'n1' });
  });

  describe('runDailyReports', () => {
    it('genera el reporte y crea la notificación para el ADMIN del negocio', async () => {
      mock(prisma.skill.findMany).mockResolvedValue([skillRow('biz_1')]);
      mock(generateDailyReport).mockResolvedValue({ date: '2026-09-28', text: 'Resumen del día' });

      await runDailyReports();

      expect(generateDailyReport).toHaveBeenCalledWith('biz_1');
      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            businessId: 'biz_1',
            userId: 'admin_1',
            type: 'GENERAL',
            channel: 'PUSH',
            body: 'Resumen del día',
          }),
        })
      );
    });

    it('excluye las skills cuyo config no es de tipo superpower', async () => {
      mock(prisma.skill.findMany).mockResolvedValue([
        skillRow('biz_1', 'other'),
        skillRowNoConfig('biz_2'),
      ]);

      await runDailyReports();

      expect(generateDailyReport).not.toHaveBeenCalled();
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('deduplica negocios repetidos (dos skills del mismo negocio → un reporte)', async () => {
      mock(prisma.skill.findMany).mockResolvedValue([skillRow('biz_1'), skillRow('biz_1')]);
      mock(generateDailyReport).mockResolvedValue({ date: '2026-09-28', text: 'x' });

      await runDailyReports();

      expect(generateDailyReport).toHaveBeenCalledTimes(1);
    });

    it('salta el negocio si no tiene ADMIN', async () => {
      mock(prisma.skill.findMany).mockResolvedValue([skillRow('biz_1')]);
      mock(prisma.user.findFirst).mockResolvedValue(null);

      await runDailyReports();

      expect(generateDailyReport).not.toHaveBeenCalled();
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('un error en un negocio no frena el procesamiento del resto', async () => {
      mock(prisma.skill.findMany).mockResolvedValue([skillRow('biz_1'), skillRow('biz_2')]);
      mock(generateDailyReport)
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ date: '2026-09-28', text: 'ok' });
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await runDailyReports();

      expect(generateDailyReport).toHaveBeenCalledTimes(2);
      expect(prisma.notification.create).toHaveBeenCalledTimes(1);
      errSpy.mockRestore();
    });
  });

  describe('startScheduler — gate de escalado horizontal', () => {
    const OLD_ENV = { ...process.env };
    afterEach(() => { process.env = { ...OLD_ENV }; });

    it('con RUN_SCHEDULER=false no programa ningún cron (otra instancia lo corre)', () => {
      process.env.NODE_ENV = 'production';
      process.env.RUN_SCHEDULER = 'false';

      startScheduler();

      expect(cron.schedule).not.toHaveBeenCalled();
    });

    it('en entorno de test no programa cron (guard de NODE_ENV)', () => {
      process.env.NODE_ENV = 'test';
      delete process.env.RUN_SCHEDULER;

      startScheduler();

      expect(cron.schedule).not.toHaveBeenCalled();
    });
  });

  describe('runReminders', () => {
    it('no notifica cuando no hay recordatorios para mañana', async () => {
      mock(prisma.skill.findMany).mockResolvedValue([skillRow('biz_1')]);
      mock(generateReminders).mockResolvedValue([]);

      await runReminders();

      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('arma el cuerpo con la lista de turnos y notifica al ADMIN', async () => {
      mock(prisma.skill.findMany).mockResolvedValue([skillRow('biz_1')]);
      mock(generateReminders).mockResolvedValue([
        { time: '10:00', clientName: 'Ana', service: 'Corte' },
        { time: '11:30', clientName: 'Beto', service: 'Barba' },
      ]);

      await runReminders();

      expect(prisma.notification.create).toHaveBeenCalledTimes(1);
      const arg = mock(prisma.notification.create).mock.calls[0][0] as { data: { type: string; body: string; title: string } };
      expect(arg.data.type).toBe('BOOKING_REMINDER');
      expect(arg.data.title).toContain('(2)');
      expect(arg.data.body).toContain('Ana');
      expect(arg.data.body).toContain('Beto');
    });
  });
});
