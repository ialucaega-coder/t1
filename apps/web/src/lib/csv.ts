/**
 * Exportación CSV del lado del cliente (RFC 4180: separador coma, comillas
 * dobles, CRLF) con protección contra inyección de fórmulas: una celda de texto
 * que empieza con = + - @ (o tab / retorno de carro) se prefija con una comilla
 * simple para que Excel / Sheets la traten como texto y no como fórmula.
 * Los números (typeof 'number') se escriben tal cual: no son un vector.
 */

export type CsvCell = string | number | boolean | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;

/** Escapa una celda: neutraliza fórmulas y aplica el entrecomillado CSV. */
export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : String(value);
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Arma el contenido CSV (sin BOM) de una matriz de filas. */
export function toCsv(rows: CsvCell[][]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

/**
 * Descarga el CSV en el navegador. Lleva BOM UTF-8 para que Excel muestre bien
 * las tildes. No hace nada fuera del navegador.
 */
export function downloadCsv(filename: string, rows: CsvCell[][]): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob(['﻿', toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
