/**
 * Tests del cliente de WhatsApp (Twilio): parseo de imágenes del webhook y
 * descarga de MediaUrl con Basic auth → base64 para la visión ("Oído y vista").
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Prisma no se usa en estas funciones, pero el módulo lo importa al cargarse.
vi.mock('../../lib/prisma', () => ({ prisma: {} }));

import {
  parseTwilioImages,
  parseTwilioAudio,
  downloadTwilioImagesAsBase64,
  isTwilioMediaUrl,
} from '../../services/whatsapp/client';

describe('parseTwilioImages', () => {
  it('devuelve [] cuando no hay medios', () => {
    expect(parseTwilioImages({ NumMedia: '0' })).toEqual([]);
    expect(parseTwilioImages({})).toEqual([]);
  });

  it('extrae solo las imágenes (ignora audio/otros content-types)', () => {
    const images = parseTwilioImages({
      NumMedia: '2',
      MediaUrl0: 'https://api.twilio.com/media/img.jpg',
      MediaContentType0: 'image/jpeg',
      MediaUrl1: 'https://api.twilio.com/media/audio.ogg',
      MediaContentType1: 'audio/ogg',
    });
    expect(images).toEqual([
      { url: 'https://api.twilio.com/media/img.jpg', mediaType: 'image/jpeg' },
    ]);
  });

  it('corta en un máximo de 4 imágenes', () => {
    const body: Record<string, string> = { NumMedia: '6' };
    for (let i = 0; i < 6; i++) {
      body[`MediaUrl${i}`] = `https://api.twilio.com/media/${i}.png`;
      body[`MediaContentType${i}`] = 'image/png';
    }
    expect(parseTwilioImages(body)).toHaveLength(4);
  });
});

describe('parseTwilioAudio', () => {
  it('extrae solo los audios (ignora imágenes)', () => {
    const audios = parseTwilioAudio({
      NumMedia: '2',
      MediaUrl0: 'https://api.twilio.com/media/voz.ogg',
      MediaContentType0: 'audio/ogg',
      MediaUrl1: 'https://api.twilio.com/media/foto.jpg',
      MediaContentType1: 'image/jpeg',
    });
    expect(audios).toEqual([
      { url: 'https://api.twilio.com/media/voz.ogg', mediaType: 'audio/ogg' },
    ]);
  });

  it('devuelve [] si no hay audios', () => {
    expect(parseTwilioAudio({ NumMedia: '0' })).toEqual([]);
  });
});

describe('isTwilioMediaUrl', () => {
  it('acepta hosts de Twilio por https y rechaza el resto', () => {
    expect(isTwilioMediaUrl('https://api.twilio.com/2010-04-01/Accounts/AC/Media/ME')).toBe(true);
    expect(isTwilioMediaUrl('https://api.us1.twilio.com/x')).toBe(true);
    expect(isTwilioMediaUrl('http://api.twilio.com/x')).toBe(false); // no https
    expect(isTwilioMediaUrl('https://atacante.com/x')).toBe(false);
    expect(isTwilioMediaUrl('https://api.twilio.com.atacante.com/x')).toBe(false);
    expect(isTwilioMediaUrl('no-es-url')).toBe(false);
  });
});

describe('downloadTwilioImagesAsBase64', () => {
  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    process.env.TWILIO_ACCOUNT_SID = 'AC_test';
    process.env.TWILIO_AUTH_TOKEN = 'token_test';
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
    vi.unstubAllGlobals();
  });

  it('devuelve [] si faltan credenciales de Twilio', async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    const result = await downloadTwilioImagesAsBase64([
      { url: 'https://api.twilio.com/media/img.jpg', mediaType: 'image/jpeg' },
    ]);
    expect(result).toEqual([]);
  });

  it('descarga con Basic auth y devuelve base64', async () => {
    const bytes = Buffer.from('fake-image-bytes');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await downloadTwilioImagesAsBase64([
      { url: 'https://api.twilio.com/media/img.jpg', mediaType: 'image/jpeg' },
    ]);

    expect(result).toEqual([
      { base64: bytes.toString('base64'), mediaType: 'image/jpeg' },
    ]);
    // Verifica que mandó el header Authorization Basic.
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers.Authorization).toMatch(/^Basic /);
    const decoded = Buffer.from(opts.headers.Authorization.replace('Basic ', ''), 'base64').toString();
    expect(decoded).toBe('AC_test:token_test');
  });

  it('descarta imágenes cuyo fetch falla (no rompe)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, headers: { get: () => null } });
    vi.stubGlobal('fetch', fetchMock);

    const result = await downloadTwilioImagesAsBase64([
      { url: 'https://api.twilio.com/media/broken.jpg', mediaType: 'image/jpeg' },
    ]);
    expect(result).toEqual([]);
  });

  it('descarta si el content-type no es imagen', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
      arrayBuffer: async () => new ArrayBuffer(8),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await downloadTwilioImagesAsBase64([
      { url: 'https://api.twilio.com/media/notimg', mediaType: 'image/jpeg' },
    ]);
    expect(result).toEqual([]);
  });

  it('NO manda credenciales a un host que no es de Twilio (anti-SSRF)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await downloadTwilioImagesAsBase64([
      { url: 'https://atacante.com/roba-token.jpg', mediaType: 'image/jpeg' },
    ]);

    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled(); // nunca se pega al host malicioso
  });

  it('deja pasar imágenes que ya vienen en base64 sin descargar', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const already = { base64: 'AAAA', mediaType: 'image/png' };
    const result = await downloadTwilioImagesAsBase64([already]);

    expect(result).toEqual([already]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('descarta imágenes que superan el tope de 5 MB', async () => {
    const big = new ArrayBuffer(5 * 1024 * 1024 + 1);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => big,
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await downloadTwilioImagesAsBase64([
      { url: 'https://api.twilio.com/media/huge.jpg', mediaType: 'image/jpeg' },
    ]);
    expect(result).toEqual([]);
  });
});
