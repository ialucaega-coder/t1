/**
 * Pruebas del catálogo de motores de IA (`src/services/ai/catalog.ts`).
 * Verifica el lookup por id, que el motor por defecto exista en el catálogo
 * y la integridad básica del catálogo (ids únicos, campos requeridos).
 */
import { describe, it, expect } from 'vitest';
import { AI_ENGINES, DEFAULT_ENGINE_ID, getEngineById } from '../../services/ai/catalog';

describe('services/ai/catalog', () => {
  it('getEngineById devuelve el motor correcto', () => {
    const engine = getEngineById(DEFAULT_ENGINE_ID);
    expect(engine).toBeDefined();
    expect(engine!.id).toBe(DEFAULT_ENGINE_ID);
  });

  it('getEngineById devuelve undefined para un id inexistente', () => {
    expect(getEngineById('motor-que-no-existe')).toBeUndefined();
  });

  it('el motor por defecto existe en el catálogo', () => {
    expect(AI_ENGINES.some((e) => e.id === DEFAULT_ENGINE_ID)).toBe(true);
  });

  it('todos los ids del catálogo son únicos', () => {
    const ids = AI_ENGINES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('cada motor tiene los campos requeridos (id, name, provider, kind, type)', () => {
    for (const e of AI_ENGINES) {
      expect(e.id).toBeTruthy();
      expect(e.name).toBeTruthy();
      expect(e.provider).toBeTruthy();
      expect(e.kind).toBeTruthy();
      expect(['api', 'local']).toContain(e.type);
    }
  });
});
