/**
 * Pruebas del evaluador de condiciones de reglas (`services/workflows/conditions.ts`).
 * Cubre parseo, comparación numérica/string, operadores y el fail-open de compat.
 */
import { describe, it, expect } from 'vitest';
import { parseCondition, matchesCondition } from '../../../services/workflows/conditions';

describe('parseCondition', () => {
  it('parsea "campo op valor"', () => {
    expect(parseCondition('monto > 1000')).toEqual({ field: 'monto', op: '>', value: '1000' });
    expect(parseCondition('canal = whatsapp')).toEqual({ field: 'canal', op: '=', value: 'whatsapp' });
  });

  it('saca comillas del valor', () => {
    expect(parseCondition('canal = "whatsapp"')?.value).toBe('whatsapp');
  });

  it('devuelve null si no tiene la forma esperada', () => {
    expect(parseCondition('cliente importante')).toBeNull();
    expect(parseCondition('')).toBeNull();
  });
});

describe('matchesCondition', () => {
  it('sin condición → matchea (sin restricción)', () => {
    expect(matchesCondition(undefined, {})).toBe(true);
    expect(matchesCondition('   ', { x: 1 })).toBe(true);
  });

  it('condición no parseable → matchea (fail-open, compat)', () => {
    expect(matchesCondition('texto en prosa', { x: 1 })).toBe(true);
  });

  it('comparación numérica', () => {
    expect(matchesCondition('monto > 1000', { monto: 1500 })).toBe(true);
    expect(matchesCondition('monto > 1000', { monto: 500 })).toBe(false);
    expect(matchesCondition('monto >= 1000', { monto: 1000 })).toBe(true);
    expect(matchesCondition('monto < 1000', { monto: 999 })).toBe(true);
    expect(matchesCondition('monto <= 1000', { monto: 1001 })).toBe(false);
  });

  it('comparación de igualdad string (case-insensitive)', () => {
    expect(matchesCondition('canal = whatsapp', { canal: 'WhatsApp' })).toBe(true);
    expect(matchesCondition('canal = whatsapp', { canal: 'email' })).toBe(false);
    expect(matchesCondition('canal != email', { canal: 'whatsapp' })).toBe(true);
  });

  it('operador contiene', () => {
    expect(matchesCondition('texto contiene urgente', { texto: 'Es URGENTE che' })).toBe(true);
    expect(matchesCondition('texto contiene urgente', { texto: 'hola' })).toBe(false);
  });

  it('un campo ausente no rompe (compara contra vacío)', () => {
    expect(matchesCondition('monto > 1000', {})).toBe(false); // '' no es > 1000
    expect(matchesCondition('canal = whatsapp', {})).toBe(false);
  });
});
