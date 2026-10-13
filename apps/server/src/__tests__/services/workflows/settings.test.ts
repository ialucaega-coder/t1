/**
 * Pruebas del "gate" de automatización por negocio (`services/workflows/settings.ts`):
 * leer el modo (live vs dry_run) y persistir el flag con tx + FOR UPDATE.
 * Se mockea Prisma para no tocar la base.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/prisma', () => {
  const tx = {
    connection: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    $queryRaw: vi.fn(async () => []),
  };
  return {
    prisma: {
      connection: { findFirst: vi.fn() },
      // $transaction ejecuta el callback con el `tx` mockeado.
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
      __tx: tx,
    },
  };
});

import { prisma } from '../../../lib/prisma';
import { isAutomationLive, getAutomationMode, setAutomationLive } from '../../../services/workflows/settings';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;
// Acceso al tx interno del mock para aserciones.
const tx = (prisma as unknown as { __tx: { connection: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> } } }).__tx;
const BIZ = 'biz_1';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isAutomationLive / getAutomationMode', () => {
  it('false (dry_run) cuando no hay registro', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue(null);
    expect(await isAutomationLive(BIZ)).toBe(false);
    expect(await getAutomationMode(BIZ)).toBe('dry_run');
  });

  it('true (live) cuando config.live === true', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue({ config: { live: true } });
    expect(await isAutomationLive(BIZ)).toBe(true);
    expect(await getAutomationMode(BIZ)).toBe('live');
  });

  it('false ante config inválida o live no booleano', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue({ config: { live: 'sí' } });
    expect(await isAutomationLive(BIZ)).toBe(false);
  });
});

describe('setAutomationLive', () => {
  it('crea el registro si no existe y devuelve el valor', async () => {
    tx.connection.findFirst.mockResolvedValue(null);

    const res = await setAutomationLive(BIZ, true);

    expect(res).toBe(true);
    expect(tx.connection.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ businessId: BIZ, config: { live: true } }) }),
    );
  });

  it('actualiza (con lock FOR UPDATE) si ya existe', async () => {
    tx.connection.findFirst.mockResolvedValue({ id: 'conn_1' });

    const res = await setAutomationLive(BIZ, false);

    expect(res).toBe(false);
    expect(tx.connection.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'conn_1' }, data: expect.objectContaining({ config: { live: false } }) }),
    );
  });
});
