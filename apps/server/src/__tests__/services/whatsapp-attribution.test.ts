/**
 * Pruebas del parser de atribución Click-to-WhatsApp
 * (`src/services/whatsapp/attribution.ts`). Es lógica pura: no necesita mocks.
 */
import { describe, it, expect } from 'vitest';
import { parseWhatsAppReferral } from '../../services/whatsapp/attribution';

describe('services/whatsapp/attribution — parseWhatsAppReferral', () => {
  it('body con todos los Referral*: arma la atribución completa', () => {
    const result = parseWhatsAppReferral({
      ReferralSourceType: 'ad',
      ReferralSourceId: 'ad_123',
      ReferralSourceUrl: 'https://fb.me/ad_123',
      ReferralHeadline: 'Oferta de verano',
      ReferralBody: '2x1 en todo el catálogo',
      ReferralCtwaClid: 'clid_abc',
      ReferralMediaType: 'image',
    });

    expect(result).not.toBeNull();
    expect(result).toEqual({
      source: 'ctwa',
      sourceType: 'ad',
      sourceId: 'ad_123',
      sourceUrl: 'https://fb.me/ad_123',
      headline: 'Oferta de verano',
      body: '2x1 en todo el catálogo',
      ctwaClid: 'clid_abc',
      mediaType: 'image',
      at: result!.at,
    });
    // `at` es un ISO válido seteado por el parser.
    expect(typeof result!.at).toBe('string');
    expect(new Date(result!.at).toISOString()).toBe(result!.at);
  });

  it('body parcial (sólo SourceId): mapea lo presente y omite el resto', () => {
    const result = parseWhatsAppReferral({ ReferralSourceId: 'ad_999' });

    expect(result).not.toBeNull();
    expect(result!.source).toBe('ctwa');
    expect(result!.sourceId).toBe('ad_999');
    // Los campos ausentes no se incluyen.
    expect(result).not.toHaveProperty('headline');
    expect(result).not.toHaveProperty('ctwaClid');
    expect(result).not.toHaveProperty('sourceType');
    expect(typeof result!.at).toBe('string');
  });

  it('señal sólo por CtwaClid: devuelve atribución', () => {
    const result = parseWhatsAppReferral({ ReferralCtwaClid: 'clid_solo' });
    expect(result).not.toBeNull();
    expect(result!.ctwaClid).toBe('clid_solo');
  });

  it('body sin ningún Referral*: devuelve null', () => {
    expect(parseWhatsAppReferral({})).toBeNull();
    expect(
      parseWhatsAppReferral({ From: 'whatsapp:+54911', Body: 'hola' }),
    ).toBeNull();
  });

  it('campos vacíos / sólo espacios: no cuentan como señal → null', () => {
    expect(
      parseWhatsAppReferral({
        ReferralSourceId: '',
        ReferralCtwaClid: '   ',
        ReferralHeadline: '',
      }),
    ).toBeNull();
  });

  it('recorta strings y omite los vacíos', () => {
    const result = parseWhatsAppReferral({
      ReferralSourceId: '  ad_777  ',
      ReferralHeadline: '',
      ReferralBody: '  texto  ',
    });
    expect(result).not.toBeNull();
    expect(result!.sourceId).toBe('ad_777');
    expect(result!.body).toBe('texto');
    expect(result).not.toHaveProperty('headline');
  });

  it('campos no-string: no rompe y los ignora', () => {
    const result = parseWhatsAppReferral({
      ReferralSourceId: 12345 as unknown,
      ReferralCtwaClid: 'clid_ok',
      ReferralHeadline: { foo: 'bar' } as unknown,
      ReferralBody: null as unknown,
      ReferralMediaType: undefined,
    });
    expect(result).not.toBeNull();
    // Sólo el campo string válido sobrevive; los no-string se ignoran.
    expect(result!.ctwaClid).toBe('clid_ok');
    expect(result).not.toHaveProperty('sourceId');
    expect(result).not.toHaveProperty('headline');
    expect(result).not.toHaveProperty('body');
    expect(result).not.toHaveProperty('mediaType');
  });

  it('body entero no-string no rompe (todo ausente → null)', () => {
    expect(
      parseWhatsAppReferral({
        ReferralSourceId: [] as unknown,
        ReferralCtwaClid: 0 as unknown,
        ReferralHeadline: false as unknown,
      }),
    ).toBeNull();
  });
});
