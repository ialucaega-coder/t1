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
    service: { findFirst: vi.fn() },
    professional: { findFirst: vi.fn() },
    schedule: { findMany: vi.fn() },
    user: { findFirst: vi.fn(), create: vi.fn() },
    booking: { findMany: vi.fn(), create: vi.fn() },
    $executeRaw: vi.fn(async () => 1),
    $transaction: vi.fn(),
  };
  // La transacción ejecuta el callback con el mismo cliente mockeado.
  prisma.$transaction.mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
  return { prisma };
});

vi.mock('../../lib/redis', () => ({ getRedis: () => null })); // estado en memoria

import { prisma } from '../../lib/prisma';
import { handleConfirmation, handleDateSelected, handleTimeSelected, setState, getState } from '../../services/telegram/conversations';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

const CHAT_ID = 123;

function buildCtx(botId = 777): { ctx: Context; reply: ReturnType<typeof vi.fn> } {
  const reply = vi.fn(async () => undefined);
  const ctx = {
    me: { id: botId },
    chat: { id: CHAT_ID },
    from: { id: 999, first_name: 'Ana', username: 'ana' },
    reply,
  } as unknown as Context;
  return { ctx, reply };
}

async function seedConfirmState(botId = 777, businessId = 'biz_1') {
  await setState(buildCtx(botId).ctx, {
    step: 'confirm',
    businessId,
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
    mock(prisma.service.findFirst).mockResolvedValue({ id: 's1', duration: 30, price: 500 });
    mock(prisma.user.findFirst).mockResolvedValue({ id: 'client_1' });
    mock(prisma.professional.findFirst).mockResolvedValue({ id: 'p1' });
  });

  it('busca el servicio acotado al negocio del chat (no cruza tenants)', async () => {
    await seedConfirmState();
    mock(prisma.booking.findMany).mockResolvedValue([]);
    mock(prisma.booking.create).mockResolvedValue({ id: 'booking_abcdef12' });

    const { ctx } = buildCtx();
    await handleConfirmation(ctx, true);

    expect(prisma.service.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({ businessId: 'biz_1' }),
    });
  });

  it('el cliente de Telegram se busca acotado al negocio (un email de otro negocio no se reutiliza)', async () => {
    await seedConfirmState();
    mock(prisma.booking.findMany).mockResolvedValue([]);
    mock(prisma.booking.create).mockResolvedValue({ id: 'booking_abcdef12' });

    await handleConfirmation(buildCtx().ctx, true);

    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { email: 'telegram_biz_1_123@localb.bot', businessId: 'biz_1' },
    });
  });

  it('si ese email ya existe en OTRO negocio no se usa su usuario como cliente: no se crea la reserva', async () => {
    await seedConfirmState();
    mock(prisma.user.findFirst).mockResolvedValue(null); // acotado por negocio: no lo ve
    mock(prisma.user.create).mockRejectedValue(new Error('Unique constraint failed on email'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { ctx, reply } = buildCtx();
    await handleConfirmation(ctx, true);

    expect(prisma.booking.create).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalled();
    err.mockRestore();
  });

  it('crea la reserva cuando no hay solape (toma el advisory lock en la tx)', async () => {
    await seedConfirmState();
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
    expect(await getState(buildCtx().ctx)).toBeUndefined(); // estado limpiado
  });

  it('NO crea la reserva y avisa cuando el horario se solapa', async () => {
    await seedConfirmState();
    // Ya hay una reserva 09:30–10:30 que pisa el slot 10:00–10:30.
    mock(prisma.booking.findMany).mockResolvedValue([{ startTime: '09:30', endTime: '10:30' }]);

    const { ctx, reply } = buildCtx();
    await handleConfirmation(ctx, true);

    expect(prisma.booking.create).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('se acaba de ocupar'));
    expect(await getState(buildCtx().ctx)).toBeUndefined();
  });

  it('no toca la DB si el usuario cancela la confirmación', async () => {
    await seedConfirmState();
    const { ctx, reply } = buildCtx();

    await handleConfirmation(ctx, false);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.booking.create).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('cancelada'));
  });
});

describe('telegram estado por bot', () => {
  it('el mismo chat hablando con bots de dos negocios no mezcla el estado', async () => {
    await seedConfirmState(111, 'biz_A');
    await seedConfirmState(222, 'biz_B');

    expect((await getState(buildCtx(111).ctx))?.businessId).toBe('biz_A');
    expect((await getState(buildCtx(222).ctx))?.businessId).toBe('biz_B');
  });
});


describe('telegram: la reserva usa el motor compartido (services/bookings)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock(prisma.service.findFirst).mockResolvedValue({ id: 's1', duration: 30, price: 500 });
    mock(prisma.user.findFirst).mockResolvedValue({ id: 'client_1' });
    mock(prisma.professional.findFirst).mockResolvedValue({ id: 'p1' });
    mock(prisma.booking.findMany).mockResolvedValue([]);
    mock(prisma.booking.create).mockResolvedValue({ id: 'booking_abcdef12' });
  });

  it('valida que el profesional sea del negocio (404 del motor => no se crea)', async () => {
    await seedConfirmState();
    mock(prisma.professional.findFirst).mockResolvedValue(null);

    const { ctx, reply } = buildCtx();
    await handleConfirmation(ctx, true);

    expect(mock(prisma.professional.findFirst).mock.calls[0][0].where).toEqual({ id: 'p1', businessId: 'biz_1' });
    expect(prisma.booking.create).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('No se pudo crear la reserva'));
  });

  it('un turno que cruzaría la medianoche se rechaza (computeEndTime) en vez de guardar un fin inválido', async () => {
    await setState(buildCtx().ctx, {
      step: 'confirm', businessId: 'biz_1', serviceId: 's1', serviceName: 'Largo', professionalId: 'p1', professionalName: 'Pro',
      date: '2024-05-01', startTime: '23:30',
    });
    mock(prisma.service.findFirst).mockResolvedValue({ id: 's1', duration: 60, price: 500 });

    const { ctx, reply } = buildCtx();
    await handleConfirmation(ctx, true);

    expect(prisma.booking.create).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('No se pudo crear la reserva'));
  });

  it('el solape se compara en MINUTOS, no como texto ("9:30" vs "10:00" como string no solapa)', async () => {
    await seedConfirmState(); // 10:00–10:30
    // Como texto '9:45' > '10:00' sería falso; en minutos 9:45–10:15 SÍ pisa 10:00–10:30.
    mock(prisma.booking.findMany).mockResolvedValue([{ startTime: '09:45', endTime: '10:15' }]);

    const { ctx, reply } = buildCtx();
    await handleConfirmation(ctx, true);

    expect(prisma.booking.create).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('se acaba de ocupar'));
  });

  it('el alta bloquea contra todo lo que no esté CANCELADO y filtra por negocio', async () => {
    await seedConfirmState();

    await handleConfirmation(buildCtx().ctx, true);

    const where = mock(prisma.booking.findMany).mock.calls[0][0].where;
    expect(where).toMatchObject({ businessId: 'biz_1', professionalId: 'p1', status: { notIn: ['CANCELLED'] } });
  });
});

describe('telegram: disponibilidad (handleDateSelected)', () => {
  const MONDAY = '2024-05-06';

  async function seedDateState() {
    await setState(buildCtx().ctx, {
      step: 'select_date', businessId: 'biz_1', serviceId: 's1', serviceName: 'Corte', professionalId: 'p1', professionalName: 'Pro',
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mock(prisma.service.findFirst).mockResolvedValue({ id: 's1', duration: 60, price: 500 });
    mock(prisma.schedule.findMany).mockResolvedValue([{ startTime: '09:00', endTime: '12:00' }]);
    mock(prisma.booking.findMany).mockResolvedValue([]);
  });

  it('usa el MISMO criterio que el alta: del negocio y status distinto de CANCELLED (antes solo PENDING/CONFIRMED y sin negocio)', async () => {
    await seedDateState();

    await handleDateSelected(buildCtx().ctx, MONDAY);

    const where = mock(prisma.booking.findMany).mock.calls[0][0].where;
    expect(where).toMatchObject({ businessId: 'biz_1', professionalId: 'p1', status: { notIn: ['CANCELLED'] } });
    // El día es el calendario (UTC), igual que al guardar la reserva.
    expect(where.date.toISOString()).toBe('2024-05-06T00:00:00.000Z');
  });

  it('el día de la semana sale del calendario (lunes = 1) sin depender de la zona del servidor y filtra horarios por negocio', async () => {
    await seedDateState();

    await handleDateSelected(buildCtx().ctx, MONDAY);

    expect(mock(prisma.schedule.findMany).mock.calls[0][0].where).toMatchObject({ businessId: 'biz_1', professionalId: 'p1', dayOfWeek: 1 });
  });

  it('no ofrece los horarios que pisa una reserva (comparación en minutos) y guarda los ofrecidos en el estado', async () => {
    await seedDateState();
    mock(prisma.booking.findMany).mockResolvedValue([{ startTime: '09:30', endTime: '10:30' }]);

    const { ctx, reply } = buildCtx();
    await handleDateSelected(ctx, MONDAY);

    // Servicio de 60 min, agenda 09:00–12:00 cada 30: 09:00 pisa, 09:30 pisa, 10:00 pisa (10:00<10:30), 10:30 y 11:00 libres.
    const state = await getState(buildCtx().ctx);
    expect(state?.slots).toEqual(['10:30', '11:00']);
    expect(state?.step).toBe('select_time');
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('Elegí un horario'), expect.anything());
  });

  it.each(['2024-13-45', 'hola', '2024-5-6', '2024-02-30', ''])('una fecha inválida del callback_data ("%s") se rechaza sin consultar la agenda', async (bad) => {
    await seedDateState();
    const { ctx, reply } = buildCtx();

    await handleDateSelected(ctx, bad);

    expect(prisma.schedule.findMany).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('no es válida'), expect.anything());
  });
});

describe('telegram: el horario del callback_data se valida (handleTimeSelected)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock(prisma.service.findFirst).mockResolvedValue({ id: 's1', duration: 30, price: 500 });
  });

  async function seedTimeState(slots: string[] | undefined) {
    await setState(buildCtx().ctx, {
      step: 'select_time', businessId: 'biz_1', serviceId: 's1', serviceName: 'Corte', professionalId: 'p1', professionalName: 'Pro',
      date: '2024-05-06', ...(slots ? { slots } : {}),
    });
  }

  it('acepta un horario que se le ofreció', async () => {
    await seedTimeState(['10:00', '10:30']);
    const { ctx, reply } = buildCtx();

    await handleTimeSelected(ctx, '10:30');

    expect((await getState(buildCtx().ctx))?.startTime).toBe('10:30');
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('Resumen'), expect.anything());
  });

  it.each(['25:99', '3:00', 'ahora', '10:30; DROP', ''])('rechaza un horario mal formado ("%s")', async (bad) => {
    await seedTimeState(['10:00', '10:30']);
    const { ctx, reply } = buildCtx();

    await handleTimeSelected(ctx, bad);

    expect((await getState(buildCtx().ctx))?.startTime).toBeUndefined();
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('no está disponible'));
  });

  it('rechaza un horario válido que NO se le ofreció (callback_data armado a mano)', async () => {
    await seedTimeState(['10:00', '10:30']);
    const { ctx, reply } = buildCtx();

    await handleTimeSelected(ctx, '03:00');

    expect((await getState(buildCtx().ctx))?.startTime).toBeUndefined();
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('no está disponible'));
  });

  it('sin horarios ofrecidos en el estado tampoco avanza', async () => {
    await seedTimeState(undefined);
    const { ctx, reply } = buildCtx();

    await handleTimeSelected(ctx, '10:00');

    expect(reply).toHaveBeenCalledWith(expect.stringContaining('no está disponible'));
  });
});
