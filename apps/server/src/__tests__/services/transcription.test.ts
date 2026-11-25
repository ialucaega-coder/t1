/**
 * Tests del servicio de transcripción de audio (Whisper / "Oído y vista").
 * Mockeamos el SDK de OpenAI y `fetch`. Nunca debe lanzar: ante cualquier
 * fallo devuelve null para no romper los webhooks.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// `vi.hoisted` evita el error de hoisting de `vi.mock` (la factory se iza sobre
// los imports; no puede referenciar variables de scope externo salvo por acá).
const { transcriptionsCreate, toFileMock } = vi.hoisted(() => ({
  transcriptionsCreate: vi.fn(),
  toFileMock: vi.fn(async () => ({ mockFile: true })),
}));

vi.mock('openai', () => ({
  default: vi.fn(() => ({ audio: { transcriptions: { create: transcriptionsCreate } } })),
  toFile: toFileMock,
}));

import {
  isTranscriptionAvailable,
  transcribeAudioBuffer,
  transcribeAudioFromUrl,
} from '../../services/ai/transcription';

const OLD_ENV = { ...process.env };

describe('transcription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...OLD_ENV, OPENAI_API_KEY: 'sk-test' };
  });
  afterEach(() => {
    process.env = { ...OLD_ENV };
    vi.unstubAllGlobals();
  });

  describe('isTranscriptionAvailable', () => {
    it('true con API key, false sin ella', () => {
      expect(isTranscriptionAvailable()).toBe(true);
      delete process.env.OPENAI_API_KEY;
      expect(isTranscriptionAvailable()).toBe(false);
    });
  });

  describe('transcribeAudioBuffer', () => {
    it('devuelve el texto transcripto', async () => {
      transcriptionsCreate.mockResolvedValue({ text: '  hola mundo  ' });
      const out = await transcribeAudioBuffer(Buffer.from('audio'), 'audio/ogg');
      expect(out).toBe('hola mundo');
      expect(toFileMock).toHaveBeenCalled();
    });

    it('devuelve null si no hay API key', async () => {
      delete process.env.OPENAI_API_KEY;
      const out = await transcribeAudioBuffer(Buffer.from('audio'), 'audio/ogg');
      expect(out).toBeNull();
      expect(transcriptionsCreate).not.toHaveBeenCalled();
    });

    it('devuelve null con buffer vacío o gigante', async () => {
      expect(await transcribeAudioBuffer(Buffer.alloc(0), 'audio/ogg')).toBeNull();
      expect(await transcribeAudioBuffer(Buffer.alloc(26 * 1024 * 1024), 'audio/ogg')).toBeNull();
      expect(transcriptionsCreate).not.toHaveBeenCalled();
    });

    it('devuelve null (no lanza) si Whisper falla', async () => {
      transcriptionsCreate.mockRejectedValue(new Error('whisper down'));
      const out = await transcribeAudioBuffer(Buffer.from('audio'), 'audio/ogg');
      expect(out).toBeNull();
    });

    it('devuelve null si el texto viene vacío', async () => {
      transcriptionsCreate.mockResolvedValue({ text: '   ' });
      expect(await transcribeAudioBuffer(Buffer.from('audio'), 'audio/ogg')).toBeNull();
    });
  });

  describe('transcribeAudioFromUrl', () => {
    it('baja el audio y lo transcribe (con headers de auth)', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'audio/ogg' },
        arrayBuffer: async () => Buffer.from('bytes').buffer,
      });
      vi.stubGlobal('fetch', fetchMock);
      transcriptionsCreate.mockResolvedValue({ text: 'transcripto' });

      const out = await transcribeAudioFromUrl('https://api.twilio.com/audio', {
        headers: { Authorization: 'Basic xyz' },
        mediaType: 'audio/ogg',
      });

      expect(out).toBe('transcripto');
      const [, opts] = fetchMock.mock.calls[0];
      expect(opts.headers.Authorization).toBe('Basic xyz');
    });

    it('corta antes de bajar si no hay API key', async () => {
      delete process.env.OPENAI_API_KEY;
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      expect(await transcribeAudioFromUrl('https://x/audio')).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('devuelve null si la descarga falla', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, headers: { get: () => null } }));
      expect(await transcribeAudioFromUrl('https://x/audio')).toBeNull();
    });
  });
});
