import { describe, it, expect } from 'vitest';
import { isLowStock, LOW_STOCK_THRESHOLD } from '@/lib/stock';

describe('lib/stock', () => {
  it('el umbral documentado es 5', () => {
    expect(LOW_STOCK_THRESHOLD).toBe(5);
  });

  it('marca stock bajo en el umbral y por debajo (incluido 0)', () => {
    expect(isLowStock(0)).toBe(true);
    expect(isLowStock(5)).toBe(true);
    expect(isLowStock(6)).toBe(false);
  });

  it('ignora valores que no son un stock numérico', () => {
    expect(isLowStock(undefined)).toBe(false);
    expect(isLowStock(null)).toBe(false);
    expect(isLowStock('2')).toBe(false);
    expect(isLowStock(NaN)).toBe(false);
  });
});
