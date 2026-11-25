/**
 * Pruebas de los límites del plan (`services/billing/limits.ts`): capacidad de
 * bots (maxBots) y de contactos (maxContacts). Prisma se mockea.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    subscription: { findUnique: vi.fn() },
    bot: { count: vi.fn() },
    user: { count: vi.fn() },
  },
}));

import { prisma } from '../../lib/prisma';
import {
  getBotCapacity, getContactCapacity, FREE_MAX_BOTS, FREE_MAX_CONTACTS,
} from '../../services/billing/limits';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

describe('services/billing/limits', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('getBotCapacity', () => {
    it('usa maxBots del plan y marca atLimit al alcanzarlo', async () => {
      mock(prisma.subscription.findUnique).mockResolvedValue({ plan: { maxBots: 5 } });
      mock(prisma.bot.count).mockResolvedValue(5);

      const c = await getBotCapacity('biz_1');
      expect(c).toEqual({ used: 5, limit: 5, atLimit: true });
    });

    it('sin suscripción usa el cupo gratuito de bots', async () => {
      mock(prisma.subscription.findUnique).mockResolvedValue(null);
      mock(prisma.bot.count).mockResolvedValue(0);

      const c = await getBotCapacity('biz_1');
      expect(c).toEqual({ used: 0, limit: FREE_MAX_BOTS, atLimit: false });
    });
  });

  describe('getContactCapacity', () => {
    it('cuenta solo clientes activos y marca atLimit con el maxContacts del plan', async () => {
      mock(prisma.subscription.findUnique).mockResolvedValue({ plan: { maxContacts: 100 } });
      mock(prisma.user.count).mockResolvedValue(100);

      const c = await getContactCapacity('biz_1');
      expect(c).toEqual({ used: 100, limit: 100, atLimit: true });
      expect(prisma.user.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: { businessId: 'biz_1', role: 'CLIENT', deletedAt: null } })
      );
    });

    it('sin suscripción usa el cupo gratuito de contactos', async () => {
      mock(prisma.subscription.findUnique).mockResolvedValue(null);
      mock(prisma.user.count).mockResolvedValue(50);

      const c = await getContactCapacity('biz_1');
      expect(c).toEqual({ used: 50, limit: FREE_MAX_CONTACTS, atLimit: false });
    });
  });
});
