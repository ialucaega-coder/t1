/**
 * Formato canónico y guard anti-hijack de teléfonos de negocio (lib/businessPhone.ts).
 */
import { describe, it, expect, vi } from 'vitest';
import { assertPhoneNumbersFree, normalizeOptionalPhone, normalizePhone, phoneDigits } from '../../lib/businessPhone';

describe('normalizePhone', () => {
  it.each([
    ['+54 9 11 2345-6789', '+5491123456789'],
    ['+5491123456789', '+5491123456789'],
    ['5491123456789', '+5491123456789'],
    ['(54) 9 11.2345.6789', '+5491123456789'],
    ['whatsapp:+5491123456789', '+5491123456789'],
    ['tel:+5491123456789', '+5491123456789'],
    ['  +54 9 11 2345 6789  ', '+5491123456789'],
  ])('"%s" => %s', (raw, expected) => {
    expect(normalizePhone(raw)).toBe(expected);
  });

  it.each(['', 'hola', '123', '+12345678901234567', '11 2345 67xx', '++5491123456789', '+54-9-11-abc'])('rechaza "%s"', (raw) => {
    expect(normalizePhone(raw)).toBeNull();
  });

  it('dos formatos del mismo número tienen los mismos dígitos', () => {
    expect(phoneDigits(normalizePhone('+54 9 11 2345-6789')!)).toBe(phoneDigits(normalizePhone('5491123456789')!));
  });
});

describe('normalizeOptionalPhone', () => {
  it('undefined => no se toca; null o vacío => se borra; válido => canónico', () => {
    expect(normalizeOptionalPhone(undefined)).toBeUndefined();
    expect(normalizeOptionalPhone(null)).toBeNull();
    expect(normalizeOptionalPhone('   ')).toBeNull();
    expect(normalizeOptionalPhone('+54 11 2345 6789')).toBe('+541123456789');
  });

  it('inválido => AppError 400 con el nombre del campo', () => {
    expect(() => normalizeOptionalPhone('abc', 'número de WhatsApp')).toThrowError(/número de WhatsApp/);
  });
});

describe('assertPhoneNumbersFree', () => {
  const tx = (rows: { id: string }[]) => ({
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async () => rows),
  });

  it('sin números no hace nada', async () => {
    const t = tx([]);
    await assertPhoneNumbersFree(t as never, 'biz_1', []);
    expect(t.$executeRaw).not.toHaveBeenCalled();
    expect(t.$queryRaw).not.toHaveBeenCalled();
  });

  it('toma un lock por número, ordenados y sin repetir, y consulta excluyendo al propio negocio', async () => {
    const t = tx([]);
    await assertPhoneNumbersFree(t as never, 'biz_1', ['+5491188887777', '+5491122223333', '+54 9 11 2222-3333']);

    expect(t.$executeRaw.mock.calls.map((c) => (c as unknown[])[1])).toEqual(['biznum:5491122223333', 'biznum:5491188887777']);
    const [strings, bizId, digits] = t.$queryRaw.mock.calls[0] as unknown as [string[], string, string[]];
    expect(strings.join(' ')).toMatch(/id <>/);
    expect(bizId).toBe('biz_1');
    expect(digits).toEqual(['5491122223333', '5491188887777']);
  });

  it('409 si otro negocio ya lo usa', async () => {
    await expect(assertPhoneNumbersFree(tx([{ id: 'otro' }]) as never, 'biz_1', ['+5491122223333'])).rejects.toMatchObject({
      statusCode: 409,
    });
  });
});
