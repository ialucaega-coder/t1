/**
 * Pruebas del paso de confirmación del flujo de reserva por Telegram
 * (`services/telegram/conversations.ts` → handleConfirmation).
 *
 * Foco: la reserva atómica con advisory lock + re-chequeo de solape dentro de la
 * transacción (previene doble booking concurrente del mismo profesional/día).
 * Prisma se mockea; el estado conversacional se siembra con el `setState` real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Context } from 'grammy';

vi.mock('../../lib/prisma', () => {
  const prisma = {
    service: { findUnique: vi.fn() },
    user: { findUnique: vi.fn(), create: vi.fn() },
    booking: { findMany: vi.fn(), create: vi.fn() },
    $executeRaw: vi.fn(async () => 1),
    $transaction: vi.fn(),
  };
  // La transacción ejecuta el callback con el mismo cliente mockeado.
  prisma.$transaction.mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
  return { prisma };
});

import { prisma } from '../../lib/prisma';
import { handleConfirmation, setState, getState } from '../../services/telegram/conversations';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

const CHAT_ID = 123;

function buildCtx(): { ctx: Context; reply: ReturnType<typeof vi.fn> } {
  const reply = vi.fn(async () => undefined);
  const ctx = {
    chat: { id: CHAT_ID },
    from: { id: 999, first_name: 'Ana', username: 'ana' },
    reply,
  } as unknown as Context;
  return { ctx, reply };
}

function seedConfirmState() {
  setState(CHAT_ID, {
    step: 'confirm',
    businessId: 'biz_1',
    serviceId: 's1',
    serviceName: 'Corte',
    professionalId: 'p1',
    professionalName: 'Pro',
    date: '2024-05-01',
    startTime: '10:00',
  });
}

describe('telegram handleConfirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock(prisma.service.findUnique).mockResolvedValue({ id: 's1', duration: 30, price: 500 });
    mock(prisma.user.findUnique).mockResolvedValue({ id: 'client_1' });
  });

  it('crea la reserva cuando no hay solape (toma el advisory lock en la tx)', async () => {
    seedConfirmState();
    mock(prisma.booking.findMany).mockResolvedValue([]); // sin reservas ese día
    mock(prisma.booking.create).mockResolvedValue({ id: 'booking_abcdef12' });

    const { ctx, reply } = buildCtx();
    await handleConfirmation(ctx, true);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw).toHaveBeenCalled(); // pg_advisory_xact_lock
    expect(prisma.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          businessId: 'biz_1',
          professionalId: 'p1',
          serviceId: 's1',
          startTime: '10:00',
          endTime: '10:30',
          source: 'TELEGRAM',
        }),
      })
    );
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('Reserva confirmada'), expect.anything());
    expect(getState(CHAT_ID)).toBeUndefined(); // estado limpiado
  });

  it('NO crea la reserva y avisa cuando el horario se solapa', async () => {
    seedConfirmState();
    // Ya hay una reserva 09:30–10:30 que pisa el slot 10:00–10:30.
    mock(prisma.booking.findMany).mockResolvedValue([{ startTime: '09:30', endTime: '10:30' }]);

    const { ctx, reply } = buildCtx();
    await handleConfirmation(ctx, true);

    expect(prisma.booking.create).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('se acaba de ocupar'));
    expect(getState(CHAT_ID)).toBeUndefined();
  });

  it('no toca la DB si el usuario cancela la confirmación', async () => {
    seedConfirmState();
    const { ctx, reply } = buildCtx();

    await handleConfirmation(ctx, false);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.booking.create).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('cancelada'));
  });
});
