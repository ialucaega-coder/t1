/**
 * Celda de CSV segura: neutraliza la inyección de fórmulas (Excel/Sheets ejecutan
 * celdas que empiezan con = + - @, tab o retorno de carro) prefijando una comilla
 * simple, y escapa las comillas dobles.
 */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
