/**
 * Telegram: un servicio dado de baja (baja lógica, deletedAt) no se puede reservar
 * aunque el chat tenga un estado de reserva en curso con ese servicio. Cada paso del
 * flujo (`services/telegram/conversations.ts`) busca el servicio con `deletedAt: null`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Context } from 'grammy';

vi.mock('../../lib/prisma', () => {
  const prisma = {
    service: { findFirst: vi.fn(), findMany: vi.fn() },
    schedule: { findMany: vi.fn() },
    user: { findFirst: vi.fn(), create: vi.fn() },
    booking: { findMany: vi.fn(), create: vi.fn() },
    $executeRaw: vi.fn(async () => 1),
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
  return { prisma };
});
vi.mock('../../lib/redis', () => ({ getRedis: () => null }));

import { prisma } from '../../lib/prisma';
import {
  setState,
  handleServiceSelected,
  handleDateSelected,
  handleTimeSelected,
  handleConfirmation,
} from '../../services/telegram/conversations';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function buildCtx(): Context {
  const noop = vi.fn(async () => undefined);
  return {
    me: { id: 777 },
    chat: { id: 123 },
    from: { id: 999, first_name: 'Ana', username: 'ana' },
    reply: noop,
    editMessageText: noop,
    answerCallbackQuery: noop,
  } as unknown as Context;
}

async function seed(step: string) {
  await setState(buildCtx(), {
    step,
    businessId: 'biz_1',
    serviceId: 's_borrado',
    serviceName: 'Corte',
    professionalId: 'p1',
    professionalName: 'Pro',
    date: '2030-05-01',
    startTime: '10:00',
  } as never);
}

describe('telegram: servicios dados de baja', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock(prisma.service.findFirst).mockResolvedValue(null); // el servicio está dado de baja
    mock(prisma.booking.findMany).mockResolvedValue([]);
    mock(prisma.schedule.findMany).mockResolvedValue([{ startTime: '09:00', endTime: '18:00', dayOfWeek: 3, isActive: true }]);
  });

  it('elegir un servicio dado de baja: lo busca con deletedAt null y avisa que no existe', async () => {
    await seed('select_service');
    const ctx = buildCtx();
    await handleServiceSelected(ctx, 's_borrado');
    expect(prisma.service.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's_borrado', businessId: 'biz_1', deletedAt: null } })
    );
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Servicio no encontrado'));
  });

  it('calcular horarios libres: el servicio se busca con deletedAt null', async () => {
    await seed('select_date');
    await handleDateSelected(buildCtx(), '2030-05-01');
    expect(prisma.service.findFirst).toHaveBeenCalledWith({
      where: { id: 's_borrado', businessId: 'biz_1', deletedAt: null },
    });
  });

  it('resumen de la reserva: el servicio se busca con deletedAt null', async () => {
    await seed('select_time');
    await handleTimeSelected(buildCtx(), '10:00');
    expect(prisma.service.findFirst).toHaveBeenCalledWith({
      where: { id: 's_borrado', businessId: 'biz_1', deletedAt: null },
    });
  });

  it('confirmar: con el servicio dado de baja no crea la reserva', async () => {
    await seed('confirm');
    const ctx = buildCtx();
    await handleConfirmation(ctx, true);
    expect(prisma.service.findFirst).toHaveBeenCalledWith({
      where: { id: 's_borrado', businessId: 'biz_1', deletedAt: null },
    });
    expect(prisma.booking.create).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Servicio no encontrado'));
  });
});
