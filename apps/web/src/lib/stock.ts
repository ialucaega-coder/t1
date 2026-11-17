/**
 * Umbral de "stock bajo": un producto con stock numérico menor o igual a este
 * valor (incluido 0) se marca como stock bajo en el listado y entra en el filtro
 * "Stock bajo". Es una constante global; todavía no es configurable por negocio.
 */
export const LOW_STOCK_THRESHOLD = 5;

/** true si `stock` es un número finito y está en o por debajo del umbral. */
export function isLowStock(stock: unknown): boolean {
  return typeof stock === 'number' && Number.isFinite(stock) && stock <= LOW_STOCK_THRESHOLD;
}
