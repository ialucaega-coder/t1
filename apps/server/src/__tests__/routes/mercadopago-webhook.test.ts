/**
 * Pruebas del webhook público de MercadoPago (`routes/mercadopagoWebhook.ts`) +
 * `services/mercadopago/payments.ts`: confirmación de pago segura e idempotente.
 *
 * Se mockean: la API de MercadoPago (`fetchPayment`), la config del negocio y
 * Prisma (en memoria, con un mutex que emula el advisory lock). Los valores son
 * todos falsos.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import crypto from 'crypto';

// ---------- Prisma en memoria ----------
const db = vi.hoisted(() => {
  interface Row { businessId: string; type: string; config: Record<string, unknown> }
  interface Txn { id: string; businessId: string; amount: number; type: string; paymentMethod: string; reference: string; notes: string }
  const state = { connections: [] as Row[], transactions: [] as Txn[], failNextCreate: false };
  let lock: Promise<void> = Promise.resolve();

  const tx = {
    $executeRaw: async () => 0,
    connection: {
      findFirst: async ({ where }: { where: { businessId: string; type: string; config: { equals: string } } }) =>
        state.connections.find(
          (r) => r.businessId === where.businessId && r.type === where.type && r.config.key === where.config.equals,
        ) ?? null,
      create: async ({ data }: { data: Row }) => { state.connections.push(data); return data; },
    },
    transaction: {
      create: async ({ data }: { data: Omit<Txn, 'id'> }) => {
        if (state.failNextCreate) { state.failNextCreate = false; throw new Error('db caída'); }
        const row = { id: `txn_${state.transactions.length + 1}`, ...data };
        state.transactions.push(row);
        return row;
      },
    },
  };
  const prisma = {
    ...tx,
    // Serializa las transacciones (emula pg_advisory_xact_lock) y deshace si falla.
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => {
      const prev = lock;
      let release!: () => void;
      lock = new Promise<void>((r) => { release = r; });
      await prev;
      const snapshot = { c: [...state.connections], t: [...state.transactions] };
      try {
        return await fn(tx);
      } catch (err) {
        state.connections = snapshot.c;
        state.transactions = snapshot.t;
        throw err;
      } finally {
        release();
      }
    },
  };
  return { state, prisma };
});

vi.mock('../../lib/prisma', () => ({ prisma: db.prisma }));
vi.mock('../../services/workflows', () => ({ dispatchEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../middleware/audit', () => ({ recordAuditEvent: vi.fn() }));
// Contadores reales en memoria (se limpian en cada test) para probar los topes.
const counters = vi.hoisted(() => new Map<string, number>());
vi.mock('../../lib/sharedState', () => ({
  sharedIncr: vi.fn(async (key: string) => {
    const n = (counters.get(key) ?? 0) + 1;
    counters.set(key, n);
    return n;
  }),
  sharedGet: vi.fn(async (key: string) => counters.get(key)),
}));
vi.mock('../../services/mercadopago/config', async (importActual) => ({
  ...(await importActual<typeof import('../../services/mercadopago/config')>()),
  loadMpConfigForWebhook: vi.fn(),
}));
vi.mock('../../services/mercadopago/client', async (importActual) => ({
  ...(await importActual<typeof import('../../services/mercadopago/client')>()),
  fetchPayment: vi.fn(),
}));

import { fetchPayment, MpTransientError } from '../../services/mercadopago/client';
import { loadMpConfigForWebhook as loadMpConfig, MpConfigError } from '../../services/mercadopago/config';
import { dispatchEvent } from '../../services/workflows';
import { recordAuditEvent } from '../../middleware/audit';
import { sharedIncr } from '../../lib/sharedState';
import { MP_COBRO_TYPE } from '../../services/mercadopago/payments';
import {
  mercadopagoWebhookRouter,
  WH_MAX_PER_BUSINESS,
  WH_MAX_PER_IP,
  WH_MAX_BAD_PER_IP_BUSINESS,
} from '../../routes/mercadopagoWebhook';
import { isPublicBodyPath, publicBodySizeGuard, jsonBodyParser } from '../../middleware/bodyLimits';
import { errorHandler } from '../../middleware/errorHandler';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const REF_1 = `cobro:biz_1:${UUID_A}`;
const REF_2 = `cobro:biz_2:${UUID_B}`;

function buildApp() {
  const app = express();
  app.set('trust proxy', true); // para simular IPs distintas con X-Forwarded-For
  // Igual que en index.ts: guard y parser con el límite por ruta.
  app.use(publicBodySizeGuard);
  app.use(jsonBodyParser());
  app.use('/api/mercadopago/webhook', mercadopagoWebhookRouter);
  app.use(errorHandler);
  return app;
}

function mpPayment(over: Record<string, unknown> = {}) {
  return {
    id: '123',
    status: 'approved',
    amount: 1500.5,
    currency: 'ARS',
    externalReference: REF_1,
    paymentType: 'credit_card',
    ...over,
  };
}

const notif = (id: string | number = 123) => ({ action: 'payment.updated', type: 'payment', data: { id: String(id) } });
const post = (app: express.Express, businessId = 'biz_1', ip = '10.0.0.1') =>
  request(app).post(`/api/mercadopago/webhook/${businessId}`).set('X-Forwarded-For', ip);

function seedCobro(businessId: string, ref: string, description = 'Seña de turno') {
  db.state.connections.push({
    businessId, type: MP_COBRO_TYPE, config: { key: ref, entityId: 'pref_1', amount: 1500.5, currency: 'ARS', description },
  });
}

beforeEach(() => {
  db.state.connections = [];
  db.state.transactions = [];
  db.state.failNextCreate = false;
  counters.clear();
  mock(loadMpConfig).mockImplementation(async (biz: string) => ({
    accessToken: `TOKEN-FALSO-${biz}`, currency: 'ARS', enabled: true,
  }));
  mock(fetchPayment).mockResolvedValue(mpPayment());
  seedCobro('biz_1', REF_1);
});

describe('webhook MercadoPago — registro del pago', () => {
  const app = buildApp();

  it('pago approved de un cobro nuestro crea UNA Transaction SALE con el monto real y reference mp:<id>', async () => {
    const res = await post(app).send(notif());

    expect(res.status).toBe(200);
    expect(db.state.transactions).toHaveLength(1);
    expect(db.state.transactions[0]).toMatchObject({
      businessId: 'biz_1', type: 'SALE', paymentMethod: 'CARD', amount: 1500.5, reference: 'mp:123',
    });
    expect(db.state.transactions[0].notes).toContain('pago #123');
    expect(db.state.transactions[0].notes).toContain('Seña de turno');
    // El pago se consulta con el token DEL negocio.
    expect(fetchPayment).toHaveBeenCalledWith('TOKEN-FALSO-biz_1', '123');
    expect(dispatchEvent).toHaveBeenCalledWith('biz_1', expect.objectContaining({ trigger: 'pago_recibido' }));
    // La auditoría no lleva token ni datos del pagador.
    expect(JSON.stringify(mock(recordAuditEvent).mock.calls)).not.toContain('TOKEN-FALSO');
  });

  it('el mismo aviso repetido no duplica la Transaction (ni dispara dos veces la automatización)', async () => {
    await post(app).send(notif());
    const again = await post(app).send(notif());

    expect(again.status).toBe(200);
    expect(db.state.transactions).toHaveLength(1);
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('dos avisos concurrentes del mismo pago registran una sola Transaction', async () => {
    const [a, b] = await Promise.all([post(app).send(notif()), post(app).send(notif())]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(db.state.transactions).toHaveLength(1);
  });

  it.each(['pending', 'in_process', 'rejected', 'cancelled', 'refunded'])('pago %s no crea Transaction', async (status) => {
    mock(fetchPayment).mockResolvedValue(mpPayment({ status }));
    const res = await post(app).send(notif());
    expect(res.status).toBe(200);
    expect(db.state.transactions).toHaveLength(0);
  });

  it('un pago que MercadoPago no reconoce (aviso falsificado) no crea nada', async () => {
    mock(fetchPayment).mockResolvedValue(null);
    const res = await post(app).send(notif(999999));
    expect(res.status).toBe(200);
    expect(db.state.transactions).toHaveLength(0);
  });

  it('si la API devuelve otro id de pago que el avisado, se ignora', async () => {
    mock(fetchPayment).mockResolvedValue(mpPayment({ id: '555' }));
    await post(app).send(notif(123));
    expect(db.state.transactions).toHaveLength(0);
  });

  it('external_reference de OTRO negocio no crea nada', async () => {
    seedCobro('biz_2', REF_2);
    mock(fetchPayment).mockResolvedValue(mpPayment({ externalReference: REF_2 }));
    const res = await post(app, 'biz_1').send(notif());
    expect(res.status).toBe(200);
    expect(db.state.transactions).toHaveLength(0);
  });

  it('external_reference con formato nuestro pero sin cobro registrado no crea nada', async () => {
    mock(fetchPayment).mockResolvedValue(mpPayment({ externalReference: `cobro:biz_1:${UUID_B}` }));
    await post(app).send(notif());
    expect(db.state.transactions).toHaveLength(0);
  });

  it.each([null, 'otra-cosa', ''])('pago sin external_reference nuestra (%s) no crea nada', async (externalReference) => {
    mock(fetchPayment).mockResolvedValue(mpPayment({ externalReference }));
    await post(app).send(notif());
    expect(db.state.transactions).toHaveLength(0);
  });

  it('multi-tenant: cada negocio registra lo suyo con SU token y SU businessId', async () => {
    seedCobro('biz_2', REF_2);
    mock(fetchPayment).mockImplementation(async (token: string, id: string) =>
      token.endsWith('biz_2') ? mpPayment({ id, externalReference: REF_2, amount: 70 }) : mpPayment({ id }),
    );

    await post(app, 'biz_1').send(notif(123));
    await post(app, 'biz_2').send(notif(123)); // mismo id de pago, otro negocio: no se pisan

    expect(db.state.transactions.map((t) => [t.businessId, t.amount])).toEqual([['biz_1', 1500.5], ['biz_2', 70]]);
    expect(fetchPayment).toHaveBeenNthCalledWith(1, 'TOKEN-FALSO-biz_1', '123');
    expect(fetchPayment).toHaveBeenNthCalledWith(2, 'TOKEN-FALSO-biz_2', '123');
  });

  it('negocio sin MercadoPago conectado: 200 sin consultar ni registrar', async () => {
    mock(loadMpConfig).mockResolvedValue(null);
    const res = await post(app).send(notif());
    expect(res.status).toBe(200);
    expect(fetchPayment).not.toHaveBeenCalled();
    expect(db.state.transactions).toHaveLength(0);
  });

  it('paymentType bank_transfer se mapea a TRANSFER y account_money a QR', async () => {
    mock(fetchPayment).mockResolvedValue(mpPayment({ paymentType: 'bank_transfer' }));
    await post(app).send(notif());
    mock(fetchPayment).mockResolvedValue(mpPayment({ id: '124', paymentType: 'account_money' }));
    await post(app).send(notif(124));
    expect(db.state.transactions.map((t) => t.paymentMethod)).toEqual(['TRANSFER', 'QR']);
  });

  it('un fallo transitorio de la API responde 503 (MP reintenta) y el reintento sí registra', async () => {
    mock(fetchPayment).mockRejectedValueOnce(new MpTransientError('timeout'));
    const first = await post(app).send(notif());
    expect(first.status).toBe(503);
    expect(db.state.transactions).toHaveLength(0);

    const retry = await post(app).send(notif());
    expect(retry.status).toBe(200);
    expect(db.state.transactions).toHaveLength(1);
  });

  it('si falla la base al registrar, la clave de idempotencia NO queda consumida', async () => {
    db.state.failNextCreate = true;
    const first = await post(app).send(notif());
    expect(first.status).toBe(503);

    const retry = await post(app).send(notif());
    expect(retry.status).toBe(200);
    expect(db.state.transactions).toHaveLength(1);
  });

  it('soporta el IPN legado por GET (?topic=payment&id=...)', async () => {
    const res = await request(app).get('/api/mercadopago/webhook/biz_1?topic=payment&id=123');
    expect(res.status).toBe(200);
    expect(db.state.transactions).toHaveLength(1);
  });
});

describe('webhook MercadoPago — firma x-signature', () => {
  const app = buildApp();
  const SECRET = 'clave-secreta-falsa';

  function sign(dataId: string, requestId: string, ts: string, secret = SECRET) {
    const v1 = crypto.createHmac('sha256', secret).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex');
    return `ts=${ts},v1=${v1}`;
  }
  const withSecret = () =>
    mock(loadMpConfig).mockResolvedValue({ accessToken: 'TOKEN-FALSO', currency: 'ARS', enabled: true, webhookSecret: SECRET });

  it('con secret configurado, una firma inválida se rechaza (401) sin consultar a MP ni registrar', async () => {
    withSecret();
    const res = await post(app).query({ 'data.id': '123' })
      .set('x-request-id', 'req-1').set('x-signature', sign('123', 'req-1', '1700000000', 'otra-clave'))
      .send(notif());
    expect(res.status).toBe(401);
    expect(fetchPayment).not.toHaveBeenCalled();
    expect(db.state.transactions).toHaveLength(0);
  });

  it('con secret configurado, un aviso sin firma se rechaza (401)', async () => {
    withSecret();
    const res = await post(app).send(notif());
    expect(res.status).toBe(401);
    expect(db.state.transactions).toHaveLength(0);
  });

  it('con secret configurado, una firma válida procesa el pago', async () => {
    withSecret();
    const res = await post(app).query({ 'data.id': '123' })
      .set('x-request-id', 'req-1').set('x-signature', sign('123', 'req-1', '1700000000'))
      .send(notif());
    expect(res.status).toBe(200);
    expect(db.state.transactions).toHaveLength(1);
  });

  it('sin secret configurado NO se exige firma (alcanza con la consulta a la API)', async () => {
    const res = await post(app).send(notif());
    expect(res.status).toBe(200);
    expect(db.state.transactions).toHaveLength(1);
  });
});

describe('webhook MercadoPago — cuerpos inválidos y límites', () => {
  const app = buildApp();

  it('JSON malformado responde 400 sin romper el server', async () => {
    const res = await post(app).set('Content-Type', 'application/json').send('{"type": "payment", ');
    expect(res.status).toBe(400);
    expect(fetchPayment).not.toHaveBeenCalled();
  });

  it.each([{}, [], { data: {} }, { type: 'payment', data: { id: 'abc/../x' } }])('cuerpo sin id de pago válido (%j) responde 400', async (body) => {
    const res = await post(app).send(body);
    expect(res.status).toBe(400);
    expect(fetchPayment).not.toHaveBeenCalled();
  });

  it('un tema que no es pago (merchant_order) se reconoce con 200 y no se procesa', async () => {
    const res = await post(app).send({ type: 'merchant_order', data: { id: '1' } });
    expect(res.status).toBe(200);
    expect(fetchPayment).not.toHaveBeenCalled();
  });

  it('cuerpos de más de 100 KB se rechazan con 413', async () => {
    const res = await post(app).send({ ...notif(), relleno: 'x'.repeat(150 * 1024) });
    expect(res.status).toBe(413);
    expect(fetchPayment).not.toHaveBeenCalled();
  });

  it('la URL sin negocio responde 400 explicando el formato', async () => {
    const res = await request(app).post('/api/mercadopago/webhook').send(notif());
    expect(res.status).toBe(400);
    expect(fetchPayment).not.toHaveBeenCalled();
  });
});

describe('webhook MercadoPago — topes que un tercero no puede agotar (H1)', () => {
  const app = buildApp();
  const SECRET = 'clave-secreta-falsa';
  const sign = (id: string, reqId: string, ts: string) =>
    `ts=${ts},v1=${crypto.createHmac('sha256', SECRET).update(`id:${id};request-id:${reqId};ts:${ts};`).digest('hex')}`;

  it('un atacante con intentos sin firma se bloquea a sí mismo y NO le quita el cupo a los avisos reales', async () => {
    mock(loadMpConfig).mockResolvedValue({ accessToken: 'TOKEN-FALSO', currency: 'ARS', enabled: true, webhookSecret: SECRET });
    for (let i = 0; i < WH_MAX_BAD_PER_IP_BUSINESS; i++) {
      expect((await post(app, 'biz_1', '6.6.6.6').send(notif())).status).toBe(401);
    }
    // La IP atacante ya está frenada...
    expect((await post(app, 'biz_1', '6.6.6.6').send(notif())).status).toBe(429);

    // ...y MercadoPago (otra IP) sigue entrando con su aviso firmado.
    const real = await post(app, 'biz_1', '203.0.113.9').query({ 'data.id': '123' })
      .set('x-request-id', 'r1').set('x-signature', sign('123', 'r1', '1700000000')).send(notif());
    expect(real.status).toBe(200);
    expect(db.state.transactions).toHaveLength(1);
  });

  it('avisos de pagos que MercadoPago no reconoce NO consumen el contador del negocio', async () => {
    mock(fetchPayment).mockResolvedValue(null);
    for (let i = 0; i < WH_MAX_PER_BUSINESS + 20; i++) {
      await post(app, 'biz_1', `7.7.${Math.floor(i / 250)}.${i % 250}`).send(notif(900000 + i));
    }
    mock(fetchPayment).mockResolvedValue(mpPayment());
    const real = await post(app, 'biz_1', '203.0.113.9').send(notif());
    expect(real.status).toBe(200);
    expect(db.state.transactions).toHaveLength(1);
  });

  it('el contador del negocio sí corta (429) cuando hay demasiados avisos verificados', async () => {
    mock(fetchPayment).mockResolvedValue(mpPayment({ status: 'pending' }));
    let last = 200;
    for (let i = 0; i <= WH_MAX_PER_BUSINESS; i++) {
      last = (await post(app, 'biz_1', `8.8.${Math.floor(i / 250)}.${i % 250}`).send(notif())).status;
    }
    expect(last).toBe(429);
  });

  it('hay un tope por IP ANTES de leer la config del negocio', async () => {
    let last = 200;
    for (let i = 0; i <= WH_MAX_PER_IP; i++) {
      last = (await post(app, 'biz_1', '9.9.9.9').send({ type: 'merchant_order', data: { id: '1' } })).status;
    }
    expect(last).toBe(429);
    mock(loadMpConfig).mockClear();
    await post(app, 'biz_1', '9.9.9.9').send(notif());
    expect(loadMpConfig).not.toHaveBeenCalled();
  });

  it('un negocio inexistente / sin MercadoPago no consume el contador del negocio', async () => {
    mock(loadMpConfig).mockResolvedValue(null);
    const res = await post(app, 'biz_fantasma').send(notif());
    expect(res.status).toBe(200);
    const keys = mock(sharedIncr).mock.calls.map((c) => String(c[0]));
    expect(keys.some((k) => k.startsWith('biz_fantasma:mp-wh:'))).toBe(false);
  });
});

describe('webhook MercadoPago — límite de cuerpo real (M1)', () => {
  const app = buildApp();

  it('el prefijo del webhook está en los paths públicos de 100 KB', () => {
    expect(isPublicBodyPath('/api/mercadopago/webhook/biz_1')).toBe(true);
    expect(isPublicBodyPath('/api/mercadopago/payment-link')).toBe(false);
  });

  it('con el guard/parser reales de index.ts, un cuerpo de más de 100 KB se corta con 413', async () => {
    const res = await post(app).send({ ...notif(), relleno: 'x'.repeat(150 * 1024) });
    expect(res.status).toBe(413);
    expect(fetchPayment).not.toHaveBeenCalled();
  });
});

describe('webhook MercadoPago — firma atada al id procesado (M2)', () => {
  const app = buildApp();
  const SECRET = 'clave-secreta-falsa';
  const sign = (id: string) =>
    `ts=1700000000,v1=${crypto.createHmac('sha256', SECRET).update(`id:${id};request-id:r1;ts:1700000000;`).digest('hex')}`;
  beforeEach(() => {
    mock(loadMpConfig).mockResolvedValue({ accessToken: 'TOKEN-FALSO', currency: 'ARS', enabled: true, webhookSecret: SECRET });
  });

  it('una firma válida para el id 123 en la URL no sirve para procesar el id 999 del cuerpo', async () => {
    mock(fetchPayment).mockResolvedValue(mpPayment({ id: '999' }));
    const res = await post(app).query({ 'data.id': '123' }).set('x-request-id', 'r1').set('x-signature', sign('123')).send(notif(999));
    expect(res.status).toBe(400);
    expect(fetchPayment).not.toHaveBeenCalled();
    expect(db.state.transactions).toHaveLength(0);
  });

  it('con secret configurado y sin data.id en la URL no hay forma de atar la firma: 401', async () => {
    const res = await post(app).set('x-request-id', 'r1').set('x-signature', sign('123')).send(notif(123));
    expect(res.status).toBe(401);
    expect(fetchPayment).not.toHaveBeenCalled();
  });
});

describe('webhook MercadoPago — moneda y monto contra el cobro (M3)', () => {
  const app = buildApp();

  it('si la moneda del pago no coincide con la del cobro NO se registra y se loguea', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mock(fetchPayment).mockResolvedValue(mpPayment({ currency: 'USD' }));
    const res = await post(app).send(notif());
    expect(res.status).toBe(200);
    expect(db.state.transactions).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('moneda'), expect.objectContaining({ esperada: 'ARS', recibida: 'USD' }));
    warn.mockRestore();
  });

  it('si el monto difiere del esperado se registra el REAL y se loguea la diferencia', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mock(fetchPayment).mockResolvedValue(mpPayment({ amount: 1200 }));
    await post(app).send(notif());
    expect(db.state.transactions).toHaveLength(1);
    expect(db.state.transactions[0].amount).toBe(1200);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('monto'), expect.objectContaining({ esperado: 1500.5, cobrado: 1200 }));
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ expectedAmount: 1500.5, paidAmount: 1200 }),
    }));
    warn.mockRestore();
  });
});

describe('webhook MercadoPago — credenciales ilegibles vs. no conectado (L2)', () => {
  const app = buildApp();

  it('si no se pueden descifrar las credenciales responde 503 (MP reintenta) y loguea claro', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mock(loadMpConfig).mockRejectedValue(new MpConfigError('No se pudieron descifrar las credenciales de MercadoPago'));
    const res = await post(app).send(notif());
    expect(res.status).toBe(503);
    expect(db.state.transactions).toHaveLength(0);
    expect(err).toHaveBeenCalledWith(expect.stringContaining('503'), expect.objectContaining({ businessId: 'biz_1' }));
    err.mockRestore();
  });

  it('si el negocio simplemente no tiene MercadoPago conectado responde 200', async () => {
    mock(loadMpConfig).mockResolvedValue(null);
    expect((await post(app).send(notif())).status).toBe(200);
  });
});
