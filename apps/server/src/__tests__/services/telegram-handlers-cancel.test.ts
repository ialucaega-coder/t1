/**
 * Cancelar una reserva desde el bot de Telegram (services/telegram/handlers.ts):
 * el callback `cancel:<id>` solo cancela reservas del NEGOCIO del bot y del CHAT
 * que lo pide (multi-tenant). Se registran los handlers sobre un bot falso.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Context } from 'grammy';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    user: { findFirst: vi.fn() },
    booking: { updateMany: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    business: { findUnique: vi.fn() },
    service: { findMany: vi.fn() },
    professional: { findMany: vi.fn() },
  },
}));
vi.mock('../../lib/redis', () => ({ getRedis: () => null }));

import { prisma } from '../../lib/prisma';
import { registerHandlers } from '../../services/telegram/handlers';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

type CallbackHandler = (ctx: Context) => Promise<void>;
let callbackHandler: CallbackHandler;

function setup(businessId = 'biz_1') {
  const bot = {
    command: vi.fn(),
    on: vi.fn((event: string, handler: CallbackHandler) => {
      if (event === 'callback_query:data') callbackHandler = handler;
    }),
  };
  registerHandlers(bot as never, businessId);
}

function cancelCtx(bookingId: string) {
  const reply = vi.fn(async () => undefined);
  const ctx = {
    chat: { id: 123 },
    callbackQuery: { data: `cancel:${bookingId}` },
    answerCallbackQuery: vi.fn(async () => undefined),
    reply,
  } as unknown as Context;
  return { ctx, reply };
}

beforeEach(() => {
  vi.clearAllMocks();
  setup('biz_1');
});

describe('telegram cancel:<id>', () => {
  it('cancela solo una reserva ACTIVA del negocio y del cliente de este chat', async () => {
    mock(prisma.user.findFirst).mockResolvedValue({ id: 'client_1' });
    mock(prisma.booking.updateMany).mockResolvedValue({ count: 1 });
    const { ctx, reply } = cancelCtx('bk_1');

    await callbackHandler(ctx);

    expect(prisma.user.findFirst).toHaveBeenCalledWith({ where: { email: 'telegram_biz_1_123@localb.bot', businessId: 'biz_1' } });
    expect(prisma.booking.updateMany).toHaveBeenCalledWith({
      where: { id: 'bk_1', businessId: 'biz_1', clientId: 'client_1', status: { in: ['PENDING', 'CONFIRMED'] } },
      data: { status: 'CANCELLED' },
    });
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('cancelada exitosamente'));
  });

  it('una reserva de OTRO negocio (o de otro cliente) no se cancela y se avisa con claridad', async () => {
    mock(prisma.user.findFirst).mockResolvedValue({ id: 'client_1' });
    mock(prisma.booking.updateMany).mockResolvedValue({ count: 0 }); // el filtro por negocio+cliente no la encuentra
    const { ctx, reply } = cancelCtx('bk_de_otro_negocio');

    await callbackHandler(ctx);

    expect(reply).toHaveBeenCalledWith(expect.stringContaining('No encontré esa reserva'));
    expect(reply).not.toHaveBeenCalledWith(expect.stringContaining('cancelada exitosamente'));
    // Nunca se actualiza por id a secas.
    expect(prisma.booking.update).not.toHaveBeenCalled();
  });

  it('un chat sin cliente registrado en este negocio no puede cancelar nada', async () => {
    mock(prisma.user.findFirst).mockResolvedValue(null);
    const { ctx, reply } = cancelCtx('bk_1');

    await callbackHandler(ctx);

    expect(prisma.booking.updateMany).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('No encontré esa reserva'));
  });

  it('un error de la base responde el aviso genérico sin romper', async () => {
    mock(prisma.user.findFirst).mockRejectedValue(new Error('db caída'));
    const { ctx, reply } = cancelCtx('bk_1');

    await callbackHandler(ctx);

    expect(reply).toHaveBeenCalledWith(expect.stringContaining('No se pudo cancelar'));
  });
});

describe('telegram /cancelar: listado de reservas', () => {
  it('el cliente del chat se busca acotado al negocio', async () => {
    const reply = vi.fn(async () => undefined);
    mock(prisma.user.findFirst).mockResolvedValue(null);
    const handlers: Record<string, (ctx: Context) => Promise<void>> = {};
    const bot = {
      command: vi.fn((name: string, h: (ctx: Context) => Promise<void>) => { handlers[name] = h; }),
      on: vi.fn(),
    };
    registerHandlers(bot as never, 'biz_1');

    await handlers.cancelar({ chat: { id: 123 }, reply } as unknown as Context);

    expect(prisma.user.findFirst).toHaveBeenCalledWith({ where: { email: 'telegram_biz_1_123@localb.bot', businessId: 'biz_1' } });
  });
});
