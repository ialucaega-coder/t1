/**
 * Scheduler por negocio en cola (services/scheduler.ts): el reparto encola UN
 * trabajo por negocio (con jobId por tipo+negocio+día) y el procesamiento de cada
 * negocio es independiente. La cola se mockea para simular Redis activo.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

const queueState = vi.hoisted(() => ({ enabled: true }));
vi.mock('../../lib/queue', () => ({
  defineQueue: vi.fn(),
  enqueue: vi.fn(async () => 'queued'),
  queuesEnabled: () => queueState.enabled,
}));

import { prisma } from '../../lib/prisma';
import { defineQueue, enqueue } from '../../lib/queue';
import { generateDailyReport, generateReminders } from '../../services/superpowers/report';
import { runDailyReports, runReminders, processSchedulerJob } from '../../services/scheduler';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;
// defineQueue corre al importar el módulo (antes de que beforeEach limpie los mocks).
const registeredQueues = [...mock(defineQueue).mock.calls];
const skillRow = (businessId: string) => ({ businessId, config: { kind: 'superpower' } });

beforeEach(() => {
  vi.clearAllMocks();
  queueState.enabled = true;
  mock(prisma.user.findFirst).mockResolvedValue({ id: 'admin_1' });
  mock(prisma.notification.create).mockResolvedValue({ id: 'n1' });
});

describe('scheduler por negocio en cola', () => {
  it('registra la cola scheduler-business con su handler al cargar el módulo', () => {
    expect(registeredQueues).toHaveLength(1);
    expect(registeredQueues[0][0]).toBe('scheduler-business');
    expect(registeredQueues[0][1]).toBe(processSchedulerJob);
  });

  it('el reparto encola un trabajo por negocio, sin ejecutar nada en el cron', async () => {
    mock(prisma.skill.findMany).mockResolvedValue([skillRow('biz_1'), skillRow('biz_2'), skillRow('biz_1')]);

    await runDailyReports();

    const calls = mock(enqueue).mock.calls;
    expect(calls).toHaveLength(2); // dedupe de negocios repetidos
    expect(calls[0][0]).toBe('scheduler-business');
    expect(calls[0][1]).toEqual({ kind: 'report', businessId: 'biz_1' });
    expect(calls[1][1]).toEqual({ kind: 'report', businessId: 'biz_2' });
    // El reparto NO genera reportes: eso lo hace el worker.
    expect(generateDailyReport).not.toHaveBeenCalled();
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it('el jobId lleva tipo, día y negocio (dedupe) y no usa ":" (BullMQ no lo permite)', async () => {
    mock(prisma.skill.findMany).mockResolvedValue([skillRow('biz_1')]);
    await runReminders();
    const [, , opts] = mock(enqueue).mock.calls[0];
    const day = new Date().toISOString().slice(0, 10);
    expect(opts.jobId).toBe(`sched_reminders_${day}_biz_1`);
    expect(opts.jobId).not.toContain(':');
  });

  it('con Redis reintenta 3 veces; sin Redis un solo intento (no frena el recorrido inline)', async () => {
    mock(prisma.skill.findMany).mockResolvedValue([skillRow('biz_1')]);

    await runDailyReports();
    expect(mock(enqueue).mock.calls[0][2].attempts).toBe(3);

    mock(enqueue).mockClear();
    queueState.enabled = false;
    await runDailyReports();
    expect(mock(enqueue).mock.calls[0][2].attempts).toBe(1);
  });

  it('processSchedulerJob crea la notificación del negocio indicado', async () => {
    mock(generateReminders).mockResolvedValue([{ time: '10:00', clientName: 'Ana', service: 'Corte' }]);

    await processSchedulerJob({ kind: 'reminders', businessId: 'biz_7' });

    expect(generateReminders).toHaveBeenCalledWith('biz_7');
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ businessId: 'biz_7', userId: 'admin_1', type: 'BOOKING_REMINDER' }),
      }),
    );
  });

  it('processSchedulerJob propaga el error (para que BullMQ reintente) y salta negocios sin ADMIN', async () => {
    mock(generateDailyReport).mockRejectedValue(new Error('boom'));
    await expect(processSchedulerJob({ kind: 'report', businessId: 'biz_1' })).rejects.toThrow('boom');

    mock(prisma.user.findFirst).mockResolvedValue(null);
    mock(generateDailyReport).mockClear();
    await expect(processSchedulerJob({ kind: 'report', businessId: 'biz_2' })).resolves.toBeUndefined();
    expect(generateDailyReport).not.toHaveBeenCalled();
  });
});
