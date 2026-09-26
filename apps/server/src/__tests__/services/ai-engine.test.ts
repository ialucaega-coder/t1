/**
 * Tests del Motor de IA por negocio: catálogo, selección, keys y resolución
 * del proveedor. Se mockea Prisma y el factory (getDefaultAIProvider) para el
 * fallback. Los constructores de proveedores no hacen red hasta generateResponse.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    connection: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('../../services/ai/factory', () => ({
  getDefaultAIProvider: vi.fn(() => ({ name: 'fallback-default' })),
}));

import { prisma } from '../../lib/prisma';
import { getDefaultAIProvider } from '../../services/ai/factory';
import { AI_ENGINES, getEngineById, DEFAULT_ENGINE_ID } from '../../services/ai/catalog';
import {
  loadEngineConfig,
  setActiveEngine,
  setEngineKey,
  getAIProviderForBusiness,
  listEnginesForBusiness,
} from '../../services/ai/engine';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;
const OLD_ENV = { ...process.env };

let seq = 0;
const uniqueBiz = () => `biz_${seq++}`;

describe('catalog', () => {
  it('tiene el motor por defecto y busca por id', () => {
    expect(getEngineById(DEFAULT_ENGINE_ID)).toBeDefined();
    expect(getEngineById('no-existe')).toBeUndefined();
    expect(AI_ENGINES.length).toBeGreaterThanOrEqual(12);
  });

  it('cada motor api de nube declara keyEnv o es local', () => {
    for (const e of AI_ENGINES) {
      if (e.type === 'local') expect(e.keyless).toBe(true);
      else expect(e.keyEnv).toBeTruthy();
    }
  });
});

describe('engine config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...OLD_ENV };
    // Sin keys globales para que los tests de "sin key" sean deterministas.
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });
  afterEach(() => { process.env = { ...OLD_ENV }; });

  it('loadEngineConfig devuelve defaults si no hay Connection', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue(null);
    const cfg = await loadEngineConfig(uniqueBiz());
    expect(cfg.activeEngineId).toBe(DEFAULT_ENGINE_ID);
    expect(cfg.keys).toEqual({});
  });

  it('setActiveEngine rechaza un motor desconocido', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue(null);
    await expect(setActiveEngine(uniqueBiz(), 'motor-fantasma')).rejects.toThrow();
  });

  it('setActiveEngine crea la Connection si no existe', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue(null);
    mock(prisma.connection.create).mockResolvedValue({ id: 'c1' });
    const cfg = await setActiveEngine(uniqueBiz(), 'gpt-4o');
    expect(cfg.activeEngineId).toBe('gpt-4o');
    expect(mock(prisma.connection.create)).toHaveBeenCalled();
  });

  it('setEngineKey guarda y luego borra la key (apiKey vacía)', async () => {
    const biz = uniqueBiz();
    mock(prisma.connection.findFirst).mockResolvedValue({ id: 'c1', config: { activeEngineId: 'gpt-4o', keys: {} } });
    mock(prisma.connection.update).mockResolvedValue({ id: 'c1' });

    const withKey = await setEngineKey(biz, 'openai', 'sk-propia');
    expect(withKey.keys.openai).toBe('sk-propia');

    mock(prisma.connection.findFirst).mockResolvedValue({ id: 'c1', config: withKey });
    const cleared = await setEngineKey(biz, 'openai', '');
    expect(cleared.keys.openai).toBeUndefined();
  });
});

describe('getAIProviderForBusiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...OLD_ENV };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });
  afterEach(() => { process.env = { ...OLD_ENV }; });

  it('usa el proveedor OpenAI-compatible con la key propia del negocio', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue({
      config: { activeEngineId: 'gpt-4o', keys: { openai: 'sk-propia' } },
    });
    const provider = await getAIProviderForBusiness(uniqueBiz());
    expect(provider.name).toBe('openai');
  });

  it('usa Anthropic nativo para un motor kind anthropic', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue({
      config: { activeEngineId: 'claude-sonnet', keys: { anthropic: 'sk-ant' } },
    });
    const provider = await getAIProviderForBusiness(uniqueBiz());
    expect(provider.name).toBe('anthropic');
  });

  it('cae al relay (key global de entorno) si el negocio no tiene key propia', async () => {
    process.env.OPENAI_API_KEY = 'sk-relay';
    mock(prisma.connection.findFirst).mockResolvedValue({
      config: { activeEngineId: 'gpt-4o', keys: {} },
    });
    const provider = await getAIProviderForBusiness(uniqueBiz());
    expect(provider.name).toBe('openai');
  });

  it('un motor local funciona sin key', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue({
      config: { activeEngineId: 'ollama-local', keys: {} },
    });
    const provider = await getAIProviderForBusiness(uniqueBiz());
    expect(provider.name).toBe('openai'); // openai-compatible apuntando a Ollama
  });

  it('cae al proveedor por defecto si no hay key ni relay', async () => {
    mock(prisma.connection.findFirst).mockResolvedValue({
      config: { activeEngineId: 'gpt-4o', keys: {} },
    });
    const provider = await getAIProviderForBusiness(uniqueBiz());
    expect(provider.name).toBe('fallback-default');
    expect(mock(getDefaultAIProvider)).toHaveBeenCalled();
  });
});

describe('listEnginesForBusiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...OLD_ENV };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });
  afterEach(() => { process.env = { ...OLD_ENV }; });

  it('marca active, hasOwnKey, relayAvailable, local y ready — sin exponer keys', async () => {
    process.env.GEMINI_API_KEY = 'relay-gemini';
    mock(prisma.connection.findFirst).mockResolvedValue({
      config: { activeEngineId: 'gpt-4o', keys: { openai: 'sk-propia' } },
    });

    const { activeEngineId, engines } = await listEnginesForBusiness(uniqueBiz());
    expect(activeEngineId).toBe('gpt-4o');

    const gpt = engines.find((e) => e.id === 'gpt-4o')!;
    expect(gpt.active).toBe(true);
    expect(gpt.hasOwnKey).toBe(true);
    expect(gpt.ready).toBe(true);

    const gemini = engines.find((e) => e.id === 'gemini-2.0-flash')!;
    expect(gemini.relayAvailable).toBe(true);
    expect(gemini.ready).toBe(true);

    const ollama = engines.find((e) => e.id === 'ollama-local')!;
    expect(ollama.local).toBe(true);
    expect(ollama.ready).toBe(true);

    // Nunca se filtran campos internos ni el valor de la key.
    expect(JSON.stringify(engines)).not.toContain('sk-propia');
    expect((gpt as Record<string, unknown>).keyEnv).toBeUndefined();
    expect((gpt as Record<string, unknown>).baseURL).toBeUndefined();
  });
});
