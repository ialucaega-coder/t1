/**
 * Pruebas de la gestión de bots de Telegram (services/telegram/bot): los bots son
 * una caché por proceso que se arma on-demand con el token de la conexión, para
 * que el webhook pueda caer en cualquier instancia.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface FakeBot {
  token: string;
  inits: number;
  updates: number;
}
interface ApiCall {
  token: string;
  method: string;
  args: unknown[];
}
interface Rec {
  bots: FakeBot[];
  apiCalls: ApiCall[];
}

// El estado de los mocks lo crea la factory de 'grammy' (corre al cargar el módulo
// bajo prueba) y se lee desde los tests vía globalThis.
const rec = (): Rec => (globalThis as unknown as { __tg: Rec }).__tg;

vi.mock('grammy', () => {
  const state: Rec = ((globalThis as unknown as { __tg?: Rec }).__tg ??= { bots: [], apiCalls: [] });
  class Bot {
    token: string;
    inits = 0;
    updates = 0;
    botInfo = { username: 'bot', first_name: 'Bot' };
    api = { deleteWebhook: async () => true, setWebhook: async () => true };
    constructor(token: string) {
      this.token = token;
      state.bots.push(this);
    }
    async init() {
      this.inits++;
    }
    async handleUpdate() {
      this.updates++;
    }
  }
  class Api {
    token: string;
    constructor(token: string) {
      this.token = token;
    }
    async deleteWebhook() {
      state.apiCalls.push({ token: this.token, method: 'deleteWebhook', args: [] });
      return true;
    }
    async setWebhook(...args: unknown[]) {
      state.apiCalls.push({ token: this.token, method: 'setWebhook', args });
      return true;
    }
  }
  return { Bot, Api };
});
vi.mock('../../services/telegram/handlers', () => ({ registerHandlers: () => undefined }));
vi.mock('../../lib/crypto', () => ({ safeDecrypt: (v: string) => v }));
vi.mock('../../lib/redis', () => ({ getRedis: () => null }));
vi.mock('../../lib/prisma', () => ({ prisma: { connection: { findMany: vi.fn() } } }));

import { handleUpdate, stopBot, restoreActiveBots } from '../../services/telegram/bot';

async function resetState() {
  const { cache } = await import('../../lib/cache');
  cache.clear();
  rec().bots.length = 0;
  rec().apiCalls.length = 0;
}

describe('telegram bot on-demand', () => {
  beforeEach(resetState);

  it('arma el bot con el token del update y lo reutiliza (un solo init)', async () => {
    await handleUpdate('biz_on_1', { update_id: 1 }, 'tok-1');
    await handleUpdate('biz_on_1', { update_id: 2 }, 'tok-1');

    expect(rec().bots).toHaveLength(1);
    expect(rec().bots[0].inits).toBe(1);
    expect(rec().bots[0].updates).toBe(2);
  });

  it('updates simultáneos del mismo negocio arman UN solo bot', async () => {
    await Promise.all([
      handleUpdate('biz_on_2', { update_id: 1 }, 'tok-2'),
      handleUpdate('biz_on_2', { update_id: 2 }, 'tok-2'),
      handleUpdate('biz_on_2', { update_id: 3 }, 'tok-2'),
    ]);
    expect(rec().bots).toHaveLength(1);
  });

  it('si el token cambió (rotado en otra instancia) rearma el bot', async () => {
    await handleUpdate('biz_on_3', { update_id: 1 }, 'tok-viejo');
    await handleUpdate('biz_on_3', { update_id: 2 }, 'tok-nuevo');

    expect(rec().bots.map((b) => b.token)).toEqual(['tok-viejo', 'tok-nuevo']);
    expect(rec().bots[1].updates).toBe(1);
  });

  it('sin token y sin bot en memoria no lanza ni procesa', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(handleUpdate('biz_on_4', { update_id: 1 })).resolves.toBeUndefined();
    expect(rec().bots).toHaveLength(0);
    warn.mockRestore();
  });
});

describe('telegram stopBot', () => {
  beforeEach(resetState);

  it('con token y sin bot local igual borra el webhook en Telegram', async () => {
    await stopBot('biz_stop_1', 'tok-remoto');
    expect(rec().apiCalls).toEqual([{ token: 'tok-remoto', method: 'deleteWebhook', args: [] }]);
  });
});

describe('telegram restoreActiveBots', () => {
  beforeEach(resetState);

  const conn = (n: number) => ({
    businessId: `biz_${n}`,
    config: { botTokenEnc: `tok-${n}`, webhookUrl: `https://x/api/telegram/webhook/biz_${n}`, webhookSecret: `s${n}` },
  });

  async function findMany() {
    const { prisma } = await import('../../lib/prisma');
    return prisma.connection.findMany as unknown as ReturnType<typeof vi.fn>;
  }

  it('re-registra el webhook de cada conexión sin armar bots en memoria', async () => {
    (await findMany()).mockResolvedValue([conn(1), conn(2), conn(3)]);
    await restoreActiveBots();

    expect(rec().bots).toHaveLength(0); // ya no se arma un Bot por tenant al arrancar
    expect(rec().apiCalls.filter((c) => c.method === 'setWebhook')).toHaveLength(3);
    expect(rec().apiCalls[0].args).toEqual(['https://x/api/telegram/webhook/biz_1', { secret_token: 's1' }]);
  });

  it('con varias instancias solo una restaura (lock compartido)', async () => {
    (await findMany()).mockResolvedValue([conn(1)]);
    await restoreActiveBots(); // instancia A toma el lock
    await restoreActiveBots(); // instancia B (mismo almacén) lo encuentra tomado

    expect(rec().apiCalls.filter((c) => c.method === 'setWebhook')).toHaveLength(1);
  });
});
