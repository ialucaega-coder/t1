/**
 * Pruebas de `dispatchEvent` (services/workflows): el disparo AUTOMÁTICO del
 * pipeline. Verifica que (a) resuelve el MODO desde los ajustes del negocio y lo
 * pasa al executor, y (b) NUNCA lanza (fire-and-forget: un fallo de automatización
 * no debe romper el flujo que lo disparó).
 *
 * Se mockean los ajustes (getAutomationMode), el executor (executeAction) y
 * Prisma (para loadWorkflows); así el test aísla el cableado de dispatchEvent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../services/workflows/settings', () => ({
  getAutomationMode: vi.fn(async () => 'dry_run'),
}));

vi.mock('../../../services/actions/executor', () => ({
  executeAction: vi.fn(async () => ({
    action: 'notificar', kind: 'interno', ok: true, status: 'ejecutado', detail: 'ok',
  })),
}));

vi.mock('../../../lib/prisma', () => ({
  prisma: { connection: { findFirst: vi.fn() } },
}));

import { prisma } from '../../../lib/prisma';
import { getAutomationMode } from '../../../services/workflows/settings';
import { executeAction } from '../../../services/actions/executor';
import { dispatchEvent } from '../../../services/workflows';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;
const BIZ = 'biz_1';

// Una regla activa que matchea 'nueva_reserva' → acción notificar.
const connWithRule = {
  config: { rules: [{ id: 'r1', nombre: 'Avisar', activo: true, trigger: 'nueva_reserva', accion: 'notificar' }] },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('dispatchEvent', () => {
  it('resuelve el modo del negocio y lo pasa al executor con el payload', async () => {
    mock(getAutomationMode).mockResolvedValue('live');
    mock(prisma.connection.findFirst).mockResolvedValue(connWithRule);

    await dispatchEvent(BIZ, { trigger: 'nueva_reserva', payload: { clientId: 'c1' } });

    expect(getAutomationMode).toHaveBeenCalledWith(BIZ);
    expect(executeAction).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: BIZ, action: 'notificar', params: { clientId: 'c1' }, mode: 'live' }),
    );
  });

  it('en dry_run (default del negocio) pasa mode dry_run', async () => {
    mock(getAutomationMode).mockResolvedValue('dry_run');
    mock(prisma.connection.findFirst).mockResolvedValue(connWithRule);

    await dispatchEvent(BIZ, { trigger: 'nueva_reserva', payload: {} });

    expect(executeAction).toHaveBeenCalledWith(expect.objectContaining({ mode: 'dry_run' }));
  });

  it('no ejecuta nada si ninguna regla matchea el trigger', async () => {
    mock(getAutomationMode).mockResolvedValue('live');
    mock(prisma.connection.findFirst).mockResolvedValue(connWithRule); // regla es de 'nueva_reserva'

    await dispatchEvent(BIZ, { trigger: 'pago_recibido', payload: {} });

    expect(executeAction).not.toHaveBeenCalled();
  });

  it('NUNCA lanza: si resolver el modo falla, se traga el error', async () => {
    mock(getAutomationMode).mockRejectedValue(new Error('boom'));

    await expect(dispatchEvent(BIZ, { trigger: 'nueva_reserva', payload: {} })).resolves.toBeUndefined();
    expect(executeAction).not.toHaveBeenCalled();
  });
});
