/**
 * Pruebas del executor de acciones compartido (`services/actions/executor.ts`),
 * el despacho que usan tanto Workflows como el orquestador Mr Go.
 *
 * Verifica: acciones internas que se ejecutan de verdad (mover etapa, notificar),
 * la acción externa gated por modo (enviar WhatsApp: simula en dry_run, envía en
 * live), las precondiciones (omitido), los placeholders (no_soportado), el scope
 * multi-tenant y que nunca lanza (status 'error' ante excepción). Se mockean los
 * servicios de los que depende para no tocar base ni enviar nada real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks de dependencias ---
vi.mock('../../../lib/prisma', () => ({
  prisma: {
    user: { findFirst: vi.fn(), findMany: vi.fn() },
    business: { findUnique: vi.fn() },
  },
}));

vi.mock('../../../services/notifications', () => ({
  createNotification: vi.fn(async () => ({ id: 'notif_1' })),
}));

vi.mock('../../../services/whatsapp/client', () => ({
  isConfigured: vi.fn(() => true),
  sendMessage: vi.fn(async () => 'wamid_1'),
}));

// lifecycle: conservamos isLifecycleStage real (función pura) y solo stubeamos
// setClientStage (la escritura).
vi.mock('../../../services/clients/lifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/clients/lifecycle')>();
  return { ...actual, setClientStage: vi.fn(async (_b: string, _c: string, stage: string) => stage) };
});

import { prisma } from '../../../lib/prisma';
import { createNotification } from '../../../services/notifications';
import * as whatsapp from '../../../services/whatsapp/client';
import { setClientStage } from '../../../services/clients/lifecycle';
import { executeAction, isExecutableAction } from '../../../services/actions/executor';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;
const BIZ = 'biz_1';

beforeEach(() => {
  vi.clearAllMocks();
  mock(whatsapp.isConfigured).mockReturnValue(true);
});

describe('executeAction — mover_lifecycle (interno)', () => {
  it('mueve la etapa cuando el cliente es del negocio y la etapa es válida', async () => {
    mock(prisma.user.findFirst).mockResolvedValue({ id: 'c1' });

    const r = await executeAction({ businessId: BIZ, action: 'mover_lifecycle', params: { clientId: 'c1', stage: 'HOT' } });

    expect(r.status).toBe('ejecutado');
    expect(r.ok).toBe(true);
    expect(setClientStage).toHaveBeenCalledWith(BIZ, 'c1', 'HOT');
    // scope multi-tenant: el cliente se busca filtrado por businessId
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c1', businessId: BIZ } }),
    );
  });

  it('omite si el cliente no pertenece al negocio', async () => {
    mock(prisma.user.findFirst).mockResolvedValue(null);

    const r = await executeAction({ businessId: BIZ, action: 'mover_lifecycle', params: { clientId: 'ajeno', stage: 'HOT' } });

    expect(r.status).toBe('omitido');
    expect(r.ok).toBe(false);
    expect(setClientStage).not.toHaveBeenCalled();
  });

  it('omite si la etapa es inválida', async () => {
    const r = await executeAction({ businessId: BIZ, action: 'mover_lifecycle', params: { clientId: 'c1', stage: 'INVENTADA' } });

    expect(r.status).toBe('omitido');
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });
});

describe('executeAction — notificar (interno)', () => {
  it('notifica a todos los admins del negocio (PUSH)', async () => {
    mock(prisma.user.findMany).mockResolvedValue([{ id: 'a1' }, { id: 'a2' }]);

    const r = await executeAction({ businessId: BIZ, action: 'notificar', params: { title: 'Ojo', body: 'Lead caliente' } });

    expect(r.status).toBe('ejecutado');
    expect(r.data?.count).toBe(2);
    expect(createNotification).toHaveBeenCalledTimes(2);
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'PUSH', businessId: BIZ, userId: 'a1' }),
    );
  });

  it('omite si el negocio no tiene admins', async () => {
    mock(prisma.user.findMany).mockResolvedValue([]);

    const r = await executeAction({ businessId: BIZ, action: 'notificar', params: {} });

    expect(r.status).toBe('omitido');
    expect(createNotification).not.toHaveBeenCalled();
  });
});

describe('executeAction — enviar_whatsapp (externo, gated por modo)', () => {
  it('en dry_run SIMULA: no envía y enmascara el teléfono', async () => {
    const r = await executeAction({
      businessId: BIZ,
      action: 'enviar_whatsapp',
      params: { to: '+5491112345678', body: 'Hola' },
      mode: 'dry_run',
    });

    expect(r.status).toBe('simulado');
    expect(r.ok).toBe(true);
    expect(whatsapp.sendMessage).not.toHaveBeenCalled();
    expect(String(r.detail)).not.toContain('2345678'); // no filtra el número
    expect(r.data?.to).toContain('5678');
  });

  it('en live envía por WhatsApp cuando está configurado y hay teléfono', async () => {
    mock(prisma.business.findUnique).mockResolvedValue({ whatsappNumber: '+100' });

    const r = await executeAction({
      businessId: BIZ,
      action: 'enviar_whatsapp',
      params: { to: '+5491112345678', body: 'Hola' },
      mode: 'live',
    });

    expect(r.status).toBe('ejecutado');
    expect(whatsapp.sendMessage).toHaveBeenCalledWith('+5491112345678', 'Hola', '+100');
  });

  it('en live omite si WhatsApp no está configurado', async () => {
    mock(whatsapp.isConfigured).mockReturnValue(false);

    const r = await executeAction({
      businessId: BIZ,
      action: 'enviar_whatsapp',
      params: { to: '+5491112345678', body: 'Hola' },
      mode: 'live',
    });

    expect(r.status).toBe('omitido');
    expect(whatsapp.sendMessage).not.toHaveBeenCalled();
  });

  it('resuelve el teléfono desde el cliente del negocio si no viene `to`', async () => {
    mock(prisma.user.findFirst).mockResolvedValue({ phone: '+5490000' });
    mock(prisma.business.findUnique).mockResolvedValue({ whatsappNumber: null });

    const r = await executeAction({
      businessId: BIZ,
      action: 'enviar_whatsapp',
      params: { clientId: 'c1', body: 'Hola' },
      mode: 'live',
    });

    expect(r.status).toBe('ejecutado');
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c1', businessId: BIZ } }),
    );
    expect(whatsapp.sendMessage).toHaveBeenCalledWith('+5490000', 'Hola', undefined);
  });

  it('omite si no hay destino ni texto', async () => {
    const r = await executeAction({ businessId: BIZ, action: 'enviar_whatsapp', params: {}, mode: 'live' });
    expect(r.status).toBe('omitido');
  });
});

describe('executeAction — placeholders y desconocidas', () => {
  it('acción reconocida sin cableado → no_soportado', async () => {
    const r = await executeAction({ businessId: BIZ, action: 'generar_link_pago', params: {} });
    expect(r.status).toBe('no_soportado');
    expect(r.ok).toBe(false);
  });

  it('acción desconocida → no_soportado', async () => {
    const r = await executeAction({ businessId: BIZ, action: 'no_existe', params: {} });
    expect(r.status).toBe('no_soportado');
  });
});

describe('executeAction — robustez', () => {
  it('nunca lanza: captura la excepción del servicio como status error', async () => {
    mock(prisma.user.findFirst).mockResolvedValue({ id: 'c1' });
    mock(setClientStage).mockRejectedValue(new Error('boom'));

    const r = await executeAction({ businessId: BIZ, action: 'mover_lifecycle', params: { clientId: 'c1', stage: 'HOT' } });

    expect(r.status).toBe('error');
    expect(r.ok).toBe(false);
  });
});

describe('isExecutableAction', () => {
  it('marca ejecutables solo las cableadas', () => {
    expect(isExecutableAction('mover_lifecycle')).toBe(true);
    expect(isExecutableAction('enviar_whatsapp')).toBe(true);
    expect(isExecutableAction('notificar')).toBe(true);
    expect(isExecutableAction('generar_link_pago')).toBe(false);
    expect(isExecutableAction('no_existe')).toBe(false);
  });
});
