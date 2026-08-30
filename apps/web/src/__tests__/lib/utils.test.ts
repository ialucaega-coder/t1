/**
 * Pruebas unitarias para las utilidades compartidas (`src/lib/utils.ts`):
 * cn, formatCurrency, formatDate y formatTime.
 */
import { describe, it, expect } from 'vitest';
import { cn, formatCurrency, formatDate, formatTime } from '@/lib/utils';

describe('lib/utils', () => {
  describe('cn', () => {
    it('combina multiples clases en un solo string', () => {
      expect(cn('a', 'b', 'c')).toBe('a b c');
    });

    it('ignora valores falsy', () => {
      expect(cn('a', false, null, undefined, 'b')).toBe('a b');
    });

    it('resuelve conflictos de tailwind conservando la ultima clase', () => {
      expect(cn('p-2', 'p-4')).toBe('p-4');
    });

    it('soporta objetos con claves condicionales', () => {
      expect(cn('base', { active: true, hidden: false })).toBe('base active');
    });
  });

  describe('formatCurrency', () => {
    it('formatea un monto con la moneda por defecto (ARS)', () => {
      const result = formatCurrency(1000);
      expect(result).toContain('1.000');
    });

    it('acepta una moneda distinta', () => {
      const result = formatCurrency(50, 'USD');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('formatea el cero correctamente', () => {
      const result = formatCurrency(0);
      expect(result).toContain('0');
    });
  });

  describe('formatDate', () => {
    it('formatea una fecha tipo Date', () => {
      const result = formatDate(new Date('2026-03-15T00:00:00Z'));
      expect(result).toMatch(/2026/);
    });

    it('formatea una fecha en formato string ISO', () => {
      const result = formatDate('2026-03-15');
      expect(result).toMatch(/2026/);
    });
  });

  describe('formatTime', () => {
    it('recorta segundos de un string HH:mm:ss', () => {
      expect(formatTime('14:30:00')).toBe('14:30');
    });

    it('deja igual un string que ya tiene formato HH:mm', () => {
      expect(formatTime('09:05')).toBe('09:05');
    });
  });
});
