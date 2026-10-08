/**
 * Pruebas del servicio de onboarding (`src/services/onboarding/checklist.ts`):
 * el checklist se CALCULA desde el estado real (marca, FAQ, bots, servicios,
 * equipo, clientes) y expone el progreso. Prisma y los loaders de marca/FAQ se
 * mockean.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    connection: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    bot: { count: vi.fn() },
    service: { count: vi.fn() },
    teamMember: { count: vi.fn() },
    user: { count: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('../../services/brand/config', () => ({
  loadBrandVoice: vi.fn(async () => ({ tono: '', publicoObjetivo: '', infoNegocio: '', reglas: '', emojis: true })),
}));
vi.mock('../../services/faq/config', () => ({
  loadFaqItems: vi.fn(async () => []),
}));

import { prisma } from '../../lib/prisma';
import { loadBrandVoice } from '../../services/brand/config';
import { loadFaqItems } from '../../services/faq/config';
import { buildOnboarding, setDismissed } from '../../services/onboarding/checklist';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

/** Por defecto todo vacío → ningún paso cumplido. */
function allEmpty() {
  mock(prisma.connection.findFirst).mockResolvedValue(null);
  mock(prisma.bot.count).mockResolvedValue(0);
  mock(prisma.service.count).mockResolvedValue(0);
  mock(prisma.teamMember.count).mockResolvedValue(0);
  mock(prisma.user.count).mockResolvedValue(0);
}

beforeEach(() => {
  vi.clearAllMocks();
  mock(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
  allEmpty();
});

describe('services/onboarding buildOnboarding', () => {
  it('negocio vacío → 0% y 8 pasos, ninguno cumplido', async () => {
    const ob = await buildOnboarding('biz_1');
    expect(ob.total).toBe(8);
    expect(ob.completed).toBe(0);
    expect(ob.percent).toBe(0);
    expect(ob.items.every((i) => !i.done)).toBe(true);
    expect(ob.dismissed).toBe(false);
  });

  it('marca con tono y FAQ con items marcan sus pasos como cumplidos', async () => {
    mock(loadBrandVoice).mockResolvedValue({ tono: 'cercano', publicoObjetivo: '', infoNegocio: '', reglas: '', emojis: true });
    mock(loadFaqItems).mockResolvedValue([{ id: '1', question: 'q', answer: 'a' }]);

    const ob = await buildOnboarding('biz_1');
    expect(ob.items.find((i) => i.id === 'brand')?.done).toBe(true);
    expect(ob.items.find((i) => i.id === 'faq')?.done).toBe(true);
    expect(ob.completed).toBe(2);
    expect(ob.percent).toBe(25); // 2 de 8
  });

  it('cuenta bot activo, servicios, equipo y clientes', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue({ id: 'ai_1' }); // AI_ENGINE existe
    mock(prisma.bot.count).mockResolvedValueOnce(2).mockResolvedValueOnce(1); // total=2, activos=1
    mock(prisma.service.count).mockResolvedValue(3);
    mock(prisma.teamMember.count).mockResolvedValue(1);
    mock(prisma.user.count).mockResolvedValue(5);

    const ob = await buildOnboarding('biz_1');
    const done = Object.fromEntries(ob.items.map((i) => [i.id, i.done]));
    expect(done['ai-engine']).toBe(true);
    expect(done['bot-created']).toBe(true);
    expect(done['bot-active']).toBe(true);
    expect(done['services']).toBe(true);
    expect(done['team']).toBe(true);
    expect(done['clients']).toBe(true);
  });

  it('lee el flag dismissed de la Connection ONBOARDING', async () => {
    mock(prisma.connection.findFirst).mockImplementation(async ({ where }: { where: { type: string } }) =>
      where.type === 'ONBOARDING' ? { config: { dismissed: true } } : null
    );
    const ob = await buildOnboarding('biz_1');
    expect(ob.dismissed).toBe(true);
  });
});

describe('services/onboarding setDismissed', () => {
  it('crea la Connection si no existe', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue(null);
    mock(prisma.connection.create).mockResolvedValue({ id: 'o1' });
    await setDismissed('biz_9', true);
    const arg = mock(prisma.connection.create).mock.calls[0][0];
    expect(arg.data.type).toBe('ONBOARDING');
    expect(arg.data.config).toEqual({ dismissed: true });
  });

  it('actualiza la Connection si ya existe', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue({ id: 'o1' });
    mock(prisma.connection.update).mockResolvedValue({ id: 'o1' });
    await setDismissed('biz_9', false);
    expect(mock(prisma.connection.update)).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'o1' }, data: { config: { dismissed: false } } })
    );
  });
});
