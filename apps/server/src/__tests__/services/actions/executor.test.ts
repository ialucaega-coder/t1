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
    user: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    business: { findUnique: vi.fn() },
    campaign: { findFirst: vi.fn() },
    service: { findFirst: vi.fn() },
    conversation: { findFirst: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('../../../lib/password', () => ({ hashPassword: vi.fn(async () => 'hashed') }));

vi.mock('../../../services/mercadopago/config', () => ({ loadMpConfig: vi.fn() }));
vi.mock('../../../services/mercadopago/client', () => ({ createPaymentPreference: vi.fn() }));
vi.mock('../../../services/mercadopago/cobros', () => ({
  buildExternalReference: vi.fn(() => 'cobro:biz_x:11111111-1111-4111-8111-111111111111'),
  buildNotificationUrl: vi.fn(),
  recordCobro: vi.fn(),
}));
vi.mock('../../../services/campaigns/send', () => ({ sendCampaign: vi.fn() }));
vi.mock('../../../services/bookings/create', () => ({ createBooking: vi.fn() }));
vi.mock('../../../services/conversationState', () => ({ transitionAttention: vi.fn() }));

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
import { loadMpConfig } from '../../../services/mercadopago/config';
import { createPaymentPreference } from '../../../services/mercadopago/client';
import { buildNotificationUrl, recordCobro } from '../../../services/mercadopago/cobros';
import { sendCampaign } from '../../../services/campaigns/send';
import { createBooking } from '../../../services/bookings/create';
import { transitionAttention } from '../../../services/conversationState';
import { AppError } from '../../../middleware/errorHandler';
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

    const r = await executeAction({ businessId: BIZ, action: 'mover_lifecycle', params: { clientId: 'c1', stage: 'HOT' }, mode: 'live' });

    expect(r.status).toBe('ejecutado');
    expect(r.ok).toBe(true);
    expect(setClientStage).toHaveBeenCalledWith(BIZ, 'c1', 'HOT');
    // scope multi-tenant: el cliente se busca filtrado por businessId
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c1', businessId: BIZ } }),
    );
  });

  it('en dry_run SIMULA: no escribe la etapa y el resultado lo dice', async () => {
    mock(prisma.user.findFirst).mockResolvedValue({ id: 'c1' });

    const r = await executeAction({ businessId: BIZ, action: 'mover_lifecycle', params: { clientId: 'c1', stage: 'HOT' }, mode: 'dry_run' });

    expect(r.status).toBe('simulado');
    expect(r.detail).toMatch(/simulado/);
    expect(r.data).toMatchObject({ dryRun: true, clientId: 'c1', stage: 'HOT' });
    expect(setClientStage).not.toHaveBeenCalled();
  });

  it('sin modo explícito el default es dry_run (no escribe)', async () => {
    mock(prisma.user.findFirst).mockResolvedValue({ id: 'c1' });
    const r = await executeAction({ businessId: BIZ, action: 'mover_lifecycle', params: { clientId: 'c1', stage: 'HOT' } });
    expect(r.status).toBe('simulado');
    expect(setClientStage).not.toHaveBeenCalled();
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

    const r = await executeAction({ businessId: BIZ, action: 'notificar', params: { title: 'Ojo', body: 'Lead caliente' }, mode: 'live' });

    expect(r.status).toBe('ejecutado');
    expect(r.data?.count).toBe(2);
    expect(createNotification).toHaveBeenCalledTimes(2);
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'PUSH', businessId: BIZ, userId: 'a1' }),
    );
  });

  it('en dry_run SIMULA: no crea notificaciones y dice cuántas crearía', async () => {
    mock(prisma.user.findMany).mockResolvedValue([{ id: 'a1' }, { id: 'a2' }]);

    const r = await executeAction({ businessId: BIZ, action: 'notificar', params: { title: 'Ojo' }, mode: 'dry_run' });

    expect(r.status).toBe('simulado');
    expect(r.data).toMatchObject({ dryRun: true, count: 2 });
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('omite si el negocio no tiene admins', async () => {
    mock(prisma.user.findMany).mockResolvedValue([]);

    const r = await executeAction({ businessId: BIZ, action: 'notificar', params: {} });

    expect(r.status).toBe('omitido');
    expect(createNotification).not.toHaveBeenCalled();
  });
});

describe('executeAction — enviar_whatsapp (externo, gated por modo)', () => {
  beforeEach(() => {
    // El número 5491112345678 es de un cliente del negocio (los demás no).
    mock(prisma.user.findMany).mockResolvedValue([{ phone: '+54 9 11 1234-5678' }]);
  });

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

  it('NO envía a un número que no es de un cliente del negocio (ni en dry_run lo da por bueno)', async () => {
    mock(prisma.user.findMany).mockResolvedValue([]);

    const live = await executeAction({ businessId: BIZ, action: 'enviar_whatsapp', params: { to: '+5491199999999', body: 'Hola' }, mode: 'live' });
    const dry = await executeAction({ businessId: BIZ, action: 'enviar_whatsapp', params: { to: '+5491199999999', body: 'Hola' }, mode: 'dry_run' });

    expect(live.status).toBe('omitido');
    expect(live.detail).toMatch(/no pertenece a un cliente/);
    expect(dry.status).toBe('omitido');
    expect(whatsapp.sendMessage).not.toHaveBeenCalled();
    // La búsqueda va scopeada por negocio.
    expect(mock(prisma.user.findMany).mock.calls[0][0].where).toMatchObject({ businessId: BIZ });
  });

  it.each(['12345', 'abc', '+0123456789', '1'.repeat(30), '+54 9 11 12 34 56 78 90 12 34'])('rechaza el teléfono con formato inválido %s', async (to) => {
    const r = await executeAction({ businessId: BIZ, action: 'enviar_whatsapp', params: { to, body: 'Hola' }, mode: 'live' });

    expect(r.status).toBe('omitido');
    expect(r.detail).toMatch(/inválido/);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(whatsapp.sendMessage).not.toHaveBeenCalled();
  });

  it('acepta el mismo número escrito con espacios y guiones', async () => {
    const r = await executeAction({ businessId: BIZ, action: 'enviar_whatsapp', params: { to: '+54 9 11 1234-5678', body: 'Hola' }, mode: 'live' });
    expect(r.status).toBe('ejecutado');
    expect(whatsapp.sendMessage).toHaveBeenCalledWith('+5491112345678', 'Hola', undefined);
  });
});

describe('executeAction — crear_cliente (interno)', () => {
  it('crea el cliente cuando hay nombre y email nuevo', async () => {
    mock(prisma.user.findFirst).mockResolvedValue(null); // no existe ese email
    mock(prisma.user.create).mockResolvedValue({ id: 'c_new' });

    const r = await executeAction({ businessId: BIZ, action: 'crear_cliente', params: { name: 'Ana', email: 'ana@x.com', phone: '+5491112345678' }, mode: 'live' });

    expect(r.status).toBe('ejecutado');
    expect(r.data?.clientId).toBe('c_new');
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'Ana', email: 'ana@x.com', role: 'CLIENT', businessId: BIZ }) }),
    );
  });

  it('en dry_run SIMULA: valida pero no crea el cliente', async () => {
    mock(prisma.user.findFirst).mockResolvedValue(null);

    const r = await executeAction({ businessId: BIZ, action: 'crear_cliente', params: { name: 'Ana', email: 'ana@x.com' }, mode: 'dry_run' });

    expect(r.status).toBe('simulado');
    expect(r.data).toMatchObject({ dryRun: true });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('valida formato y largo: nombre largo, email inválido, teléfono inválido', async () => {
    mock(prisma.user.findFirst).mockResolvedValue(null);
    const longName = await executeAction({ businessId: BIZ, action: 'crear_cliente', params: { name: 'x'.repeat(101), email: 'a@x.com' }, mode: 'live' });
    const badEmail = await executeAction({ businessId: BIZ, action: 'crear_cliente', params: { name: 'Ana', email: 'no-es-email' }, mode: 'live' });
    const longEmail = await executeAction({ businessId: BIZ, action: 'crear_cliente', params: { name: 'Ana', email: `${'a'.repeat(250)}@x.com` }, mode: 'live' });
    const badPhone = await executeAction({ businessId: BIZ, action: 'crear_cliente', params: { name: 'Ana', email: 'a@x.com', phone: '123' }, mode: 'live' });

    for (const r of [longName, badEmail, longEmail, badPhone]) expect(r.status).toBe('omitido');
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('una carrera con otro alta (P2002) da un mensaje genérico, sin filtrar el código de Prisma', async () => {
    mock(prisma.user.findFirst).mockResolvedValue(null);
    mock(prisma.user.create).mockRejectedValue(Object.assign(new Error('Unique constraint failed on the fields: (`email`)'), { name: 'PrismaClientKnownRequestError', code: 'P2002' }));

    const r = await executeAction({ businessId: BIZ, action: 'crear_cliente', params: { name: 'Ana', email: 'ana@x.com' }, mode: 'live' });

    expect(r.status).toBe('omitido');
    expect(JSON.stringify(r)).not.toMatch(/P2002|email`|Unique/);
  });

  it('omite si falta nombre o email', async () => {
    const r1 = await executeAction({ businessId: BIZ, action: 'crear_cliente', params: { email: 'a@x.com' } });
    expect(r1.status).toBe('omitido');
    const r2 = await executeAction({ businessId: BIZ, action: 'crear_cliente', params: { name: 'Ana' } });
    expect(r2.status).toBe('omitido');
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('omite si ya existe un cliente con ese email (no duplica)', async () => {
    mock(prisma.user.findFirst).mockResolvedValue({ id: 'ya' });

    const r = await executeAction({ businessId: BIZ, action: 'crear_cliente', params: { name: 'Ana', email: 'ana@x.com' } });

    expect(r.status).toBe('omitido');
    expect(prisma.user.create).not.toHaveBeenCalled();
  });
});

describe('executeAction — generar_link_pago (externo, gated)', () => {
  it('omite si el monto es inválido o ausente', async () => {
    const r = await executeAction({ businessId: BIZ, action: 'generar_link_pago', params: {}, mode: 'live' });
    expect(r.status).toBe('omitido');
  });

  it('en dry_run SIMULA (no llama a MercadoPago)', async () => {
    const r = await executeAction({ businessId: BIZ, action: 'generar_link_pago', params: { monto: 1500 }, mode: 'dry_run' });
    expect(r.status).toBe('simulado');
    expect(loadMpConfig).not.toHaveBeenCalled();
  });

  it('en live crea la preferencia y devuelve la url', async () => {
    mock(loadMpConfig).mockResolvedValue({ accessToken: 'tok', enabled: true, currency: 'ARS' });
    mock(createPaymentPreference).mockResolvedValue({ id: 'pref_1', initPoint: 'https://mp/checkout/1' });

    const r = await executeAction({ businessId: BIZ, action: 'generar_link_pago', params: { monto: 1500, titulo: 'Seña' }, mode: 'live' });

    expect(r.status).toBe('ejecutado');
    expect(r.data?.url).toBe('https://mp/checkout/1');
    expect(createPaymentPreference).toHaveBeenCalledWith('tok', expect.objectContaining({ amount: 1500, currency: 'ARS' }));
  });

  it('en live manda external_reference y notification_url propios y guarda el cobro (el pago se registra solo)', async () => {
    mock(loadMpConfig).mockResolvedValue({ accessToken: 'tok', enabled: true, currency: 'ARS' });
    mock(buildNotificationUrl).mockReturnValue('https://api.test/api/mercadopago/webhook/' + BIZ);
    mock(createPaymentPreference).mockResolvedValue({ id: 'pref_1', initPoint: 'https://mp/checkout/1' });

    const r = await executeAction({ businessId: BIZ, action: 'generar_link_pago', params: { monto: 1500, titulo: 'Seña' }, mode: 'live' });

    expect(createPaymentPreference).toHaveBeenCalledWith('tok', expect.objectContaining({
      externalReference: 'cobro:biz_x:11111111-1111-4111-8111-111111111111',
      notificationUrl: 'https://api.test/api/mercadopago/webhook/' + BIZ,
    }));
    expect(recordCobro).toHaveBeenCalledWith(BIZ, 'cobro:biz_x:11111111-1111-4111-8111-111111111111', {
      preferenceId: 'pref_1', amount: 1500, currency: 'ARS', description: 'Seña',
    });
    expect(r.data).toMatchObject({ url: 'https://mp/checkout/1', id: 'pref_1', autoRegister: true });
  });

  it('en live sin base pública no manda notification_url y avisa autoRegister=false (sigue devolviendo el link)', async () => {
    mock(loadMpConfig).mockResolvedValue({ accessToken: 'tok', enabled: true, currency: 'ARS' });
    mock(buildNotificationUrl).mockReturnValue(undefined);
    mock(createPaymentPreference).mockResolvedValue({ id: 'pref_1', initPoint: 'https://mp/checkout/1' });

    const r = await executeAction({ businessId: BIZ, action: 'generar_link_pago', params: { monto: 10 }, mode: 'live' });

    expect(r.status).toBe('ejecutado');
    expect(r.data).toMatchObject({ url: 'https://mp/checkout/1', autoRegister: false });
    expect(mock(createPaymentPreference).mock.calls[0][1].notificationUrl).toBeUndefined();
    expect(recordCobro).toHaveBeenCalled();
  });

  it('en dry_run no guarda ningún cobro', async () => {
    await executeAction({ businessId: BIZ, action: 'generar_link_pago', params: { monto: 1500 }, mode: 'dry_run' });
    expect(recordCobro).not.toHaveBeenCalled();
  });

  it('en live omite si MercadoPago no está conectado', async () => {
    mock(loadMpConfig).mockResolvedValue(null);
    const r = await executeAction({ businessId: BIZ, action: 'generar_link_pago', params: { monto: 1500 }, mode: 'live' });
    expect(r.status).toBe('omitido');
    expect(createPaymentPreference).not.toHaveBeenCalled();
  });
});

describe('executeAction — lanzar_campana (externo, gated)', () => {
  it('omite si falta el id de la campaña', async () => {
    const r = await executeAction({ businessId: BIZ, action: 'lanzar_campana', params: {}, mode: 'live' });
    expect(r.status).toBe('omitido');
  });

  it('en dry_run SIMULA verificando que exista (no envía)', async () => {
    mock(prisma.campaign.findFirst).mockResolvedValue({ id: 'c1', name: 'Promo' });
    const r = await executeAction({ businessId: BIZ, action: 'lanzar_campana', params: { campaignId: 'c1' }, mode: 'dry_run' });
    expect(r.status).toBe('simulado');
    expect(sendCampaign).not.toHaveBeenCalled();
  });

  it('en live envía la campaña vía el servicio', async () => {
    mock(sendCampaign).mockResolvedValue({ id: 'c1', envio: { enviados: 3, fallidos: 1, canalSoportado: true } });
    const r = await executeAction({ businessId: BIZ, action: 'lanzar_campana', params: { campaignId: 'c1' }, mode: 'live' });
    expect(r.status).toBe('ejecutado');
    expect(r.data?.enviados).toBe(3);
    expect(sendCampaign).toHaveBeenCalledWith(BIZ, 'c1', undefined);
  });

  it('mapea AppError 400/404 del servicio a omitido', async () => {
    mock(sendCampaign).mockRejectedValue(new AppError(400, 'Campaign already sent'));
    const r = await executeAction({ businessId: BIZ, action: 'lanzar_campana', params: { campaignId: 'c1' }, mode: 'live' });
    expect(r.status).toBe('omitido');
    expect(r.detail).toContain('already sent');
  });
});

describe('executeAction — crear_reserva (externo, gated)', () => {
  it('omite si faltan datos', async () => {
    const r = await executeAction({ businessId: BIZ, action: 'crear_reserva', params: { serviceId: 'svc_1' }, mode: 'live' });
    expect(r.status).toBe('omitido');
  });

  it('en dry_run SIMULA verificando que el servicio exista', async () => {
    mock(prisma.service.findFirst).mockResolvedValue({ id: 'svc_1', name: 'Corte' });
    const r = await executeAction({
      businessId: BIZ,
      action: 'crear_reserva',
      params: { serviceId: 'svc_1', date: '2026-02-01', startTime: '10:00', clientId: 'c1', professionalId: 'p1' },
      mode: 'dry_run',
    });
    expect(r.status).toBe('simulado');
    expect(createBooking).not.toHaveBeenCalled();
  });

  it('en dry_run busca el servicio excluyendo los dados de baja (deletedAt null) y omite si no aparece', async () => {
    mock(prisma.service.findFirst).mockResolvedValue(null);
    const r = await executeAction({
      businessId: BIZ,
      action: 'crear_reserva',
      params: { serviceId: 'svc_borrado', date: '2026-02-01', startTime: '10:00', clientId: 'c1', professionalId: 'p1' },
      mode: 'dry_run',
    });
    expect(r.status).toBe('omitido');
    expect(prisma.service.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'svc_borrado', businessId: BIZ, deletedAt: null } })
    );
  });

  it('en live crea la reserva vía el motor', async () => {
    mock(createBooking).mockResolvedValue({ id: 'bk_1' });
    const r = await executeAction({
      businessId: BIZ,
      action: 'crear_reserva',
      params: { serviceId: 'svc_1', date: '2026-02-01', startTime: '10:00', clientId: 'c1', professionalId: 'p1' },
      mode: 'live',
    });
    expect(r.status).toBe('ejecutado');
    expect(r.data?.bookingId).toBe('bk_1');
    expect(createBooking).toHaveBeenCalledWith(
      BIZ,
      expect.objectContaining({ serviceId: 'svc_1', clientId: 'c1', professionalId: 'p1' }),
      '',
    );
  });

  it('mapea AppError 409 del motor (solape) a omitido', async () => {
    mock(createBooking).mockRejectedValue(new AppError(409, 'Ese horario ya está reservado para el profesional.'));
    const r = await executeAction({
      businessId: BIZ,
      action: 'crear_reserva',
      params: { serviceId: 'svc_1', date: '2026-02-01', startTime: '10:00', clientId: 'c1', professionalId: 'p1' },
      mode: 'live',
    });
    expect(r.status).toBe('omitido');
    expect(r.detail).toContain('reservado');
  });
});

describe('executeAction — asignar_agente (interno) en dry_run', () => {
  it('SIMULA: verifica la conversación pero no deriva ni notifica', async () => {
    mock(prisma.conversation.findFirst).mockResolvedValue({ id: 'conv_1' });

    const r = await executeAction({ businessId: BIZ, action: 'asignar_agente', params: { conversationId: 'conv_1' }, mode: 'dry_run' });

    expect(r.status).toBe('simulado');
    expect(r.data).toMatchObject({ dryRun: true, conversationId: 'conv_1' });
    expect(transitionAttention).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
    expect(prisma.conversation.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'conv_1', businessId: BIZ } }));
  });

  it('omite si la conversación no es del negocio', async () => {
    mock(prisma.conversation.findFirst).mockResolvedValue(null);
    const r = await executeAction({ businessId: BIZ, action: 'asignar_agente', params: { conversationId: 'ajena' }, mode: 'dry_run' });
    expect(r.status).toBe('omitido');
  });
});

describe('executeAction — asignar_agente (interno)', () => {
  it('omite si falta la conversación', async () => {
    const r = await executeAction({ businessId: BIZ, action: 'asignar_agente', params: {} });
    expect(r.status).toBe('omitido');
    expect(transitionAttention).not.toHaveBeenCalled();
  });

  it('omite si la conversación no es del negocio (la transición va scopeada por negocio)', async () => {
    mock(transitionAttention).mockResolvedValue({ ok: false, reason: 'not_found' });
    const r = await executeAction({ businessId: BIZ, action: 'asignar_agente', params: { conversationId: 'conv_ajena' }, mode: 'live' });
    expect(r.status).toBe('omitido');
    expect(transitionAttention).toHaveBeenCalledWith('conv_ajena', BIZ, { type: 'handoff' });
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('NO resucita una conversación CERRADA ni avisa a los admins', async () => {
    mock(transitionAttention).mockResolvedValue({ ok: false, reason: 'closed' });
    const r = await executeAction({ businessId: BIZ, action: 'asignar_agente', params: { conversationId: 'conv_1' }, mode: 'live' });
    expect(r.ok).toBe(false);
    expect(r.status).toBe('omitido');
    expect(r.detail).toMatch(/cerrada/);
    expect(createNotification).not.toHaveBeenCalled();
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it('deriva la conversación por la transición atómica (HANDOFF) y notifica a los admins', async () => {
    mock(transitionAttention).mockResolvedValue({ ok: true, changed: true, state: 'ESPERANDO', status: 'HANDOFF', metadata: {} });
    mock(prisma.user.findMany).mockResolvedValue([{ id: 'a1' }]);
    const r = await executeAction({ businessId: BIZ, action: 'asignar_agente', params: { conversationId: 'conv_1' }, mode: 'live' });
    expect(r.status).toBe('ejecutado');
    expect(transitionAttention).toHaveBeenCalledWith('conv_1', BIZ, { type: 'handoff' });
    // Ya no escribe el status "a mano": todo pasa por la máquina de estados.
    expect(prisma.conversation.update).not.toHaveBeenCalled();
    expect(createNotification).toHaveBeenCalledTimes(1);
  });

  it('si ya estaba derivada o la atiende una persona no cambia nada ni re-notifica', async () => {
    mock(transitionAttention).mockResolvedValue({ ok: true, changed: false, state: 'HUMANO', status: 'OPEN', metadata: {} });
    const r = await executeAction({ businessId: BIZ, action: 'asignar_agente', params: { conversationId: 'conv_1' }, mode: 'live' });
    expect(r.ok).toBe(true);
    expect(createNotification).not.toHaveBeenCalled();
  });
});

describe('executeAction — desconocidas', () => {
  it('acción desconocida → no_soportado', async () => {
    const r = await executeAction({ businessId: BIZ, action: 'no_existe', params: {} });
    expect(r.status).toBe('no_soportado');
  });
});

describe('executeAction — robustez', () => {
  it('nunca lanza: captura la excepción del servicio como status error', async () => {
    mock(prisma.user.findFirst).mockResolvedValue({ id: 'c1' });
    mock(setClientStage).mockRejectedValue(new Error('boom'));

    const r = await executeAction({ businessId: BIZ, action: 'mover_lifecycle', params: { clientId: 'c1', stage: 'HOT' }, mode: 'live' });

    expect(r.status).toBe('error');
    expect(r.ok).toBe(false);
  });

  it('un error de Prisma no filtra el código ni el mensaje en el detalle', async () => {
    mock(prisma.user.findFirst).mockResolvedValue({ id: 'c1' });
    mock(setClientStage).mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { name: 'PrismaClientKnownRequestError', code: 'P2002' }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const r = await executeAction({ businessId: BIZ, action: 'mover_lifecycle', params: { clientId: 'c1', stage: 'HOT' }, mode: 'live' });

    expect(r.status).toBe('error');
    expect(r.detail).toBe('error de base de datos');
    expect(r.detail).not.toMatch(/P2002/);
  });
});

describe('isExecutableAction', () => {
  it('marca ejecutables solo las cableadas', () => {
    expect(isExecutableAction('mover_lifecycle')).toBe(true);
    expect(isExecutableAction('enviar_whatsapp')).toBe(true);
    expect(isExecutableAction('notificar')).toBe(true);
    expect(isExecutableAction('crear_cliente')).toBe(true);
    expect(isExecutableAction('generar_link_pago')).toBe(true);
    expect(isExecutableAction('lanzar_campana')).toBe(true);
    expect(isExecutableAction('crear_reserva')).toBe(true);
    expect(isExecutableAction('asignar_agente')).toBe(true);
    expect(isExecutableAction('no_existe')).toBe(false);
  });
});
