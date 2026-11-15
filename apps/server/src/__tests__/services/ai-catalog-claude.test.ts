import { describe, it, expect } from 'vitest';
import { AI_ENGINES, DEFAULT_ENGINE_ID, getEngineById } from '../../services/ai/catalog';

describe('catálogo de IA — motores Claude', () => {
  it('cada motor Claude declara su modelo (ninguno cae al default implícito)', () => {
    const claude = AI_ENGINES.filter((e) => e.provider === 'anthropic');
    expect(claude.map((e) => e.model)).toEqual(['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5']);
  });

  it('el motor por defecto es Claude Sonnet', () => {
    expect(getEngineById(DEFAULT_ENGINE_ID)?.model).toBe('claude-sonnet-5-5');
  });

  it('los ids de motor son únicos', () => {
    const ids = AI_ENGINES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
