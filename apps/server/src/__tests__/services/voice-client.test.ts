/**
 * Pruebas del cliente de voz (`src/services/voice/client.ts`).
 *  - isVoiceConfigured / getVoiceConfig: lectura de env con defaults.
 *  - validateVoiceSignature: fail-closed sin authToken; delega en Twilio.
 *  - resolveBusinessByNumber: normaliza el número (quita `tel:`), matchea por
 *    phone/whatsapp, y aplica los fallbacks (env default, primer negocio en dev,
 *    null en producción).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const validateRequest = vi.fn();

vi.mock('twilio', () => ({
  default: {
    validateRequest: (...args: unknown[]) => validateRequest(...args),
    twiml: { VoiceResponse: class {} },
  },
}));

vi.mock('../../lib/prisma', () => ({
  prisma: {
    business: { findFirst: vi.fn(), findUnique: vi.fn() },
  },
}));

import { prisma } from '../../lib/prisma';
import {
  isVoiceConfigured,
  getVoiceConfig,
  validateVoiceSignature,
  resolveBusinessByNumber,
} from '../../services/voice/client';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

const ENV_KEYS = [
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'VOICE_LANGUAGE',
  'VOICE_TTS_VOICE',
  'DEFAULT_VOICE_BUSINESS_ID',
  'NODE_ENV',
];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('services/voice/client', () => {
  describe('isVoiceConfigured', () => {
    it('true solo con ambas credenciales de Twilio', () => {
      expect(isVoiceConfigured()).toBe(false);
      process.env.TWILIO_ACCOUNT_SID = 'AC1';
      expect(isVoiceConfigured()).toBe(false);
      process.env.TWILIO_AUTH_TOKEN = 'tok';
      expect(isVoiceConfigured()).toBe(true);
    });
  });

  describe('getVoiceConfig', () => {
    it('usa los defaults cuando no hay env', () => {
      expect(getVoiceConfig()).toEqual({ language: 'es-MX', voice: 'Polly.Mia' });
    });
    it('respeta los overrides de env', () => {
      process.env.VOICE_LANGUAGE = 'es-AR';
      process.env.VOICE_TTS_VOICE = 'Polly.Andres';
      expect(getVoiceConfig()).toEqual({ language: 'es-AR', voice: 'Polly.Andres' });
    });
  });

  describe('validateVoiceSignature', () => {
    it('devuelve false (fail-closed) cuando no hay TWILIO_AUTH_TOKEN', () => {
      const ok = validateVoiceSignature('https://x/webhook', { a: '1' }, 'sig');
      expect(ok).toBe(false);
      expect(validateRequest).not.toHaveBeenCalled();
    });

    it('delega en twilio.validateRequest con los argumentos correctos', () => {
      process.env.TWILIO_AUTH_TOKEN = 'tok';
      validateRequest.mockReturnValue(true);

      const ok = validateVoiceSignature('https://x/webhook', { From: '+549' }, 'firma');

      expect(ok).toBe(true);
      expect(validateRequest).toHaveBeenCalledWith('tok', 'firma', 'https://x/webhook', { From: '+549' });
    });
  });

  describe('resolveBusinessByNumber', () => {
    it('normaliza el prefijo tel: y matchea por phone/whatsapp', async () => {
      mock(prisma.business.findFirst).mockResolvedValue({ id: 'biz_1' });

      const id = await resolveBusinessByNumber('tel:+5491122334455');

      expect(id).toBe('biz_1');
      const whereArg = mock(prisma.business.findFirst).mock.calls[0][0].where;
      expect(whereArg.OR).toEqual([{ phone: '+5491122334455' }, { whatsappNumber: '+5491122334455' }]);
    });

    it('cae a DEFAULT_VOICE_BUSINESS_ID cuando no hay match por número', async () => {
      mock(prisma.business.findFirst).mockResolvedValue(null);
      process.env.DEFAULT_VOICE_BUSINESS_ID = 'biz_env';
      mock(prisma.business.findUnique).mockResolvedValue({ id: 'biz_env' });

      const id = await resolveBusinessByNumber('+000');
      expect(id).toBe('biz_env');
    });

    it('en desarrollo cae al primer negocio activo', async () => {
      process.env.NODE_ENV = 'development';
      // 1er findFirst (por número) => null; 2do findFirst (primer activo) => biz_first
      mock(prisma.business.findFirst)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'biz_first' });

      const id = await resolveBusinessByNumber('+999');
      expect(id).toBe('biz_first');
    });

    it('en producción devuelve null si no hay match ni default', async () => {
      process.env.NODE_ENV = 'production';
      mock(prisma.business.findFirst).mockResolvedValue(null);

      const id = await resolveBusinessByNumber('+999');
      expect(id).toBeNull();
    });
  });
});
