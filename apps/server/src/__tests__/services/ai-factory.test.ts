/**
 * Pruebas de la fábrica de proveedores de IA (`src/services/ai/factory.ts`).
 * Es lógica pura dirigida por variables de entorno: qué proveedores están
 * configurados, el error claro cuando falta la API key, la caché en memoria
 * y la selección del proveedor por defecto (AI_PROVIDER o el primero disponible).
 *
 * Las clases de proveedor se mockean para no instanciar SDKs reales, y se usa
 * `resetModules` + import dinámico para partir de una caché limpia en cada test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../services/ai/providers/anthropic', () => ({
  AnthropicProvider: vi.fn().mockImplementation((config) => ({ __brand: 'anthropic', config })),
}));
vi.mock('../../services/ai/providers/openai', () => ({
  OpenAIProvider: vi.fn().mockImplementation((config) => ({ __brand: 'openai', config })),
}));

type Factory = typeof import('../../services/ai/factory');

const AI_ENV_KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'OPENAI_API_KEY', 'OPENAI_MODEL', 'AI_PROVIDER'];
const savedEnv: Record<string, string | undefined> = {};

async function loadFactory(): Promise<Factory> {
  vi.resetModules(); // caché de proveedores fresca por cada import
  return import('../../services/ai/factory');
}

beforeEach(() => {
  for (const key of AI_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of AI_ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('services/ai/factory', () => {
  describe('isProviderConfigured / listAvailableProviders', () => {
    it('refleja qué proveedores tienen API key en el entorno', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-x';
      const { isProviderConfigured, listAvailableProviders } = await loadFactory();

      expect(isProviderConfigured('anthropic')).toBe(true);
      expect(isProviderConfigured('openai')).toBe(false);
      expect(listAvailableProviders()).toEqual([
        { name: 'anthropic', configured: true },
        { name: 'openai', configured: false },
      ]);
    });
  });

  describe('createAIProvider', () => {
    it('lanza un error claro cuando falta la API key', async () => {
      const { createAIProvider } = await loadFactory();
      expect(() => createAIProvider('openai')).toThrow(/Falta configurar OPENAI_API_KEY/);
    });

    it('instancia el proveedor con la key y el modelo del entorno', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-x';
      process.env.ANTHROPIC_MODEL = 'claude-test';
      const { createAIProvider } = await loadFactory();

      const provider = createAIProvider('anthropic') as unknown as { __brand: string; config: { apiKey: string; model?: string } };
      expect(provider.__brand).toBe('anthropic');
      expect(provider.config.apiKey).toBe('sk-ant-x');
      expect(provider.config.model).toBe('claude-test');
    });

    it('los overrides tienen prioridad sobre el entorno', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-env';
      const { createAIProvider } = await loadFactory();

      const provider = createAIProvider('anthropic', { apiKey: 'sk-override', model: 'm2' }) as unknown as {
        config: { apiKey: string; model?: string };
      };
      expect(provider.config.apiKey).toBe('sk-override');
      expect(provider.config.model).toBe('m2');
    });

    it('reutiliza la instancia cacheada para la misma clave', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-x';
      const { createAIProvider } = await loadFactory();

      const a = createAIProvider('anthropic');
      const b = createAIProvider('anthropic');
      expect(a).toBe(b); // misma referencia -> vino de la caché
    });
  });

  describe('getDefaultAIProvider', () => {
    it('respeta AI_PROVIDER cuando está seteado y es válido', async () => {
      process.env.AI_PROVIDER = 'openai';
      process.env.OPENAI_API_KEY = 'sk-openai';
      process.env.ANTHROPIC_API_KEY = 'sk-ant';
      const { getDefaultAIProvider } = await loadFactory();

      const provider = getDefaultAIProvider() as unknown as { __brand: string };
      expect(provider.__brand).toBe('openai');
    });

    it('cae al primer proveedor configurado si no hay AI_PROVIDER', async () => {
      process.env.OPENAI_API_KEY = 'sk-openai';
      const { getDefaultAIProvider } = await loadFactory();

      const provider = getDefaultAIProvider() as unknown as { __brand: string };
      expect(provider.__brand).toBe('openai'); // anthropic no está configurado
    });

    it('lanza cuando no hay ningún proveedor configurado', async () => {
      const { getDefaultAIProvider } = await loadFactory();
      expect(() => getDefaultAIProvider()).toThrow(/No hay ningún proveedor de IA configurado/);
    });
  });
});
