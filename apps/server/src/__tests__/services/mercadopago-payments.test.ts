/**
 * Pruebas de las utilidades puras de `services/mercadopago/payments.ts`:
 * external_reference, notification_url (sin dominios hardcodeados) y firma.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import crypto from 'crypto';

vi.mock('../../lib/prisma', () => ({ prisma: {} }));
vi.mock('../../services/workflows', () => ({ dispatchEvent: vi.fn() }));

import {
  buildExternalReference,
  parseExternalReference,
  buildNotificationUrl,
  verifyMpSignature,
} from '../../services/mercadopago/payments';

const OLD_ENV = { ...process.env };
afterEach(() => { process.env = { ...OLD_ENV }; });

describe('services/mercadopago/payments', () => {
  it('buildExternalReference incluye el negocio, es único y se puede parsear', () => {
    const a = buildExternalReference('biz_1');
    const b = buildExternalReference('biz_1');
    expect(a).not.toBe(b);
    expect(parseExternalReference(a)?.businessId).toBe('biz_1');
    expect(parseExternalReference('cobro:biz_1:no-es-uuid')).toBeNull();
    expect(parseExternalReference(undefined)).toBeNull();
  });

  it('buildNotificationUrl usa la base del entorno y el negocio en el path', () => {
    delete process.env.FRONTEND_URL;
    process.env.API_PUBLIC_URL = 'https://api.ejemplo.test/';
    expect(buildNotificationUrl('biz_1')).toBe('https://api.ejemplo.test/api/mercadopago/webhook/biz_1');
  });

  it('buildNotificationUrl no devuelve nada sin base pública (o en localhost)', () => {
    delete process.env.API_PUBLIC_URL;
    delete process.env.FRONTEND_URL;
    expect(buildNotificationUrl('biz_1')).toBeUndefined();
    process.env.API_PUBLIC_URL = 'http://localhost:4000';
    expect(buildNotificationUrl('biz_1')).toBeUndefined();
  });

  it('verifyMpSignature valida el HMAC del manifiesto y rechaza alteraciones', () => {
    const secret = 'clave-falsa';
    const v1 = crypto.createHmac('sha256', secret).update('id:abc;request-id:r1;ts:100;').digest('hex');
    const base = { secret, requestId: 'r1', dataId: 'ABC' };
    expect(verifyMpSignature({ ...base, signatureHeader: `ts=100,v1=${v1}` })).toBe(true);
    expect(verifyMpSignature({ ...base, signatureHeader: `ts=101,v1=${v1}` })).toBe(false);
    expect(verifyMpSignature({ ...base, dataId: 'otro', signatureHeader: `ts=100,v1=${v1}` })).toBe(false);
    expect(verifyMpSignature({ ...base, signatureHeader: 'basura' })).toBe(false);
    expect(verifyMpSignature({ ...base, signatureHeader: undefined })).toBe(false);
  });
});
