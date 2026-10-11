/**
 * Pruebas del cupo mensual de mensajes (`services/billing/quota.ts`): cuenta los
 * mensajes del bot en el período del plan y marca overQuota. Prisma se mockea.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    subscription: { findUnique: vi.fn() },
    message: { count: vi.fn() },
  },
}));
// Caché real pero con claves por businessId: usamos ids distintos por test para
// no cruzar resultados cacheados entre casos.
import { prisma } from '../../lib/prisma';
import { getMessageQuota, FREE_MONTHLY_MESSAGES } from '../../services/billing/quota';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

describe('services/billing/quota', () => {
  beforeEach(() => vi.clearAllMocks());

  it('usa el límite del plan y marca overQuota cuando se alcanza', async () => {
    mock(prisma.subscription.findUnique).mockResolvedValue({
      currentPeriodStart: new Date('2026-10-01T00:00:00Z'),
      currentPeriodEnd: new Date('2026-11-01T00:00:00Z'),
      plan: { name: 'Pro', maxMessages: 1000 },
    });
    mock(prisma.message.count).mockResolvedValue(1000);

    const q = await getMessageQuota('biz_over');
    expect(q.limit).toBe(1000);
    expect(q.used).toBe(1000);
    expect(q.remaining).toBe(0);
    expect(q.overQuota).toBe(true);
    expect(q.plan).toBe('Pro');
    // Cuenta mensajes del bot del negocio desde el inicio del período.
    expect(prisma.message.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ role: 'BOT', conversation: { businessId: 'biz_over' } }),
      })
    );
  });

  it('sin suscripción usa el cupo gratuito por defecto', async () => {
    mock(prisma.subscription.findUnique).mockResolvedValue(null);
    mock(prisma.message.count).mockResolvedValue(10);

    const q = await getMessageQuota('biz_free');
    expect(q.limit).toBe(FREE_MONTHLY_MESSAGES);
    expect(q.used).toBe(10);
    expect(q.overQuota).toBe(false);
    expect(q.plan).toBeNull();
    expect(q.periodEnd).toBeNull();
  });

  it('remaining nunca es negativo aunque se pase del límite', async () => {
    mock(prisma.subscription.findUnique).mockResolvedValue(null);
    mock(prisma.message.count).mockResolvedValue(FREE_MONTHLY_MESSAGES + 50);

    const q = await getMessageQuota('biz_exceeded');
    expect(q.remaining).toBe(0);
    expect(q.overQuota).toBe(true);
  });
});
