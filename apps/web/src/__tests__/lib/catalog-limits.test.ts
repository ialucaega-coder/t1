import { describe, it, expect } from 'vitest';
import { durationError, priceError, stockError, MAX_PRICE } from '@/lib/catalog-limits';
import { isStaleProductError, PRODUCT_STALE_MESSAGE } from '@/lib/api/products';

describe('lib/catalog-limits', () => {
  it('precio: obligatorio > 0 y con tope de la columna Decimal(10,2)', () => {
    expect(priceError(0)).toBe('El precio debe ser mayor a 0');
    expect(priceError(MAX_PRICE)).toBe('');
    expect(priceError(MAX_PRICE + 1)).toBe('El precio no puede superar 99.999.999,99');
  });

  it('stock: entero, no negativo y hasta 1.000.000', () => {
    expect(stockError(0)).toBe('');
    expect(stockError(1_000_000)).toBe('');
    expect(stockError(1_000_001)).toBe('El stock no puede superar 1.000.000');
    expect(stockError(1.5)).toMatch(/entero/);
    expect(stockError(-1)).toMatch(/entero/);
  });

  it('duración: entera, > 0 y hasta 1440 minutos', () => {
    expect(durationError(1440)).toBe('');
    expect(durationError(1441)).toBe('La duración no puede superar 1440 minutos (24 h)');
    expect(durationError(0)).toMatch(/mayor a 0/);
  });
});

describe('isStaleProductError', () => {
  it('reconoce el 409 de edición sobre datos viejos', () => {
    expect(isStaleProductError(new Error(PRODUCT_STALE_MESSAGE))).toBe(true);
    expect(isStaleProductError(new Error('otro'))).toBe(false);
    expect(isStaleProductError('texto')).toBe(false);
  });

  it('el texto coincide con el que devuelve el server', () => {
    expect(PRODUCT_STALE_MESSAGE).toBe('El producto cambió mientras lo editabas: recargá');
  });
});
