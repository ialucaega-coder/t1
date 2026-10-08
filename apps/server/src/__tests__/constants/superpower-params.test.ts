/**
 * Pruebas del módulo de parámetros configurables de superpoderes
 * (`src/constants/superpowerParams.ts`): normalización por tipo (number con
 * clamp, select contra opciones, text con trim/maxLength), descarte de claves
 * desconocidas y relleno de defaults.
 */
import { describe, it, expect } from 'vitest';
import {
  hasParams,
  sanitizeSuperpowerParams,
  resolveSuperpowerParams,
} from '../../constants/superpowerParams';

describe('constants/superpowerParams', () => {
  describe('hasParams', () => {
    it('es true para superpoderes con spec y false para el resto', () => {
      expect(hasParams('Turbo respuesta')).toBe(true);
      expect(hasParams('Cazador de ventas')).toBe(true);
      expect(hasParams('Modo seguro')).toBe(false);
      expect(hasParams('Inexistente')).toBe(false);
    });
  });

  describe('sanitizeSuperpowerParams', () => {
    it('devuelve {} para un superpoder sin spec', () => {
      expect(sanitizeSuperpowerParams('Modo seguro', { x: 1 })).toEqual({});
    });

    it('number: clampa al rango y redondea', () => {
      expect(sanitizeSuperpowerParams('Turbo respuesta', { maxOraciones: 99 })).toEqual({ maxOraciones: 6 });
      expect(sanitizeSuperpowerParams('Turbo respuesta', { maxOraciones: 0 })).toEqual({ maxOraciones: 1 });
      expect(sanitizeSuperpowerParams('Turbo respuesta', { maxOraciones: 2.7 })).toEqual({ maxOraciones: 3 });
    });

    it('number: cae al default si no es numérico', () => {
      expect(sanitizeSuperpowerParams('Turbo respuesta', { maxOraciones: 'abc' })).toEqual({ maxOraciones: 3 });
      expect(sanitizeSuperpowerParams('Turbo respuesta', {})).toEqual({ maxOraciones: 3 });
    });

    it('select: solo acepta valores del catálogo, si no usa el default', () => {
      expect(sanitizeSuperpowerParams('Cazador de ventas', { intensidad: 'directa' })).toEqual({ intensidad: 'directa' });
      expect(sanitizeSuperpowerParams('Cazador de ventas', { intensidad: 'agresivísima' })).toEqual({ intensidad: 'media' });
    });

    it('text: trim + maxLength y descarta claves desconocidas', () => {
      const res = sanitizeSuperpowerParams('Pide resenas Google', {
        enlaceResenas: '  https://g.page/r/abc  ',
        malicioso: 'x',
      });
      expect(res).toEqual({ enlaceResenas: 'https://g.page/r/abc' });
    });
  });

  describe('resolveSuperpowerParams', () => {
    it('rellena defaults cuando el config guardado está vacío o es inválido', () => {
      expect(resolveSuperpowerParams('Encuestas de satisfaccion', null)).toEqual({ escalaMax: '5' });
      expect(resolveSuperpowerParams('Encuestas de satisfaccion', { escalaMax: '10' })).toEqual({ escalaMax: '10' });
    });
  });
});
