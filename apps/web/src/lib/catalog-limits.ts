/**
 * Topes de los formularios de catálogo. Espejan los del server
 * (apps/server/src/validators/products.ts y services.ts) para avisar antes de enviar.
 */
export const MAX_PRICE = 99_999_999.99; // columna Decimal(10,2)
export const MAX_STOCK = 1_000_000;
export const MAX_DURATION_MIN = 1440; // un día

/** Devuelve el mensaje de error de precio, o '' si es válido. */
export function priceError(price: number): string {
  if (!(price > 0)) return 'El precio debe ser mayor a 0';
  if (price > MAX_PRICE) return 'El precio no puede superar 99.999.999,99';
  return '';
}

/** Devuelve el mensaje de error de stock, o '' si es válido. */
export function stockError(stock: number): string {
  if (!Number.isInteger(stock) || stock < 0) return 'El stock debe ser un número entero mayor o igual a 0';
  if (stock > MAX_STOCK) return 'El stock no puede superar 1.000.000';
  return '';
}

/** Devuelve el mensaje de error de duración, o '' si es válida. */
export function durationError(duration: number): string {
  if (!Number.isInteger(duration) || duration <= 0) return 'La duración debe ser un número entero de minutos mayor a 0';
  if (duration > MAX_DURATION_MIN) return 'La duración no puede superar 1440 minutos (24 h)';
  return '';
}
