/** CSV del cliente: escapado RFC 4180 y protección contra inyección de fórmulas. */
import { describe, it, expect } from 'vitest';
import { csvCell, toCsv } from '@/lib/csv';

describe('lib/csv — csvCell', () => {
  it('prefija con comilla simple el texto que empieza con = + - @ (inyección de fórmulas)', () => {
    expect(csvCell('=HYPERLINK("http://malo","click")')).toBe(`"'=HYPERLINK(""http://malo"",""click"")"`);
    expect(csvCell('+cmd|calc')).toBe(`'+cmd|calc`);
    expect(csvCell('-2+3')).toBe(`'-2+3`);
    expect(csvCell('@SUM(A1)')).toBe(`'@SUM(A1)`);
  });

  it('también neutraliza tab y retorno de carro iniciales', () => {
    expect(csvCell('\t=1+1')).toBe(`'\t=1+1`);
    expect(csvCell('\r=1+1')).toBe(`"'\r=1+1"`);
  });

  it('no toca el texto normal ni los números (incluidos los negativos)', () => {
    expect(csvCell('Corte de pelo')).toBe('Corte de pelo');
    expect(csvCell(-3.5)).toBe('-3.5');
    expect(csvCell(0)).toBe('0');
  });

  it('entrecomilla comas, comillas y saltos de línea', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('dijo "hola"')).toBe('"dijo ""hola"""');
    expect(csvCell('l1\nl2')).toBe('"l1\nl2"');
  });

  it('null, undefined y números no finitos quedan vacíos', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(NaN)).toBe('');
  });
});

describe('lib/csv — toCsv', () => {
  it('une filas con CRLF y celdas con coma', () => {
    expect(toCsv([['a', 1], ['=x', null]])).toBe(`a,1\r\n'=x,`);
  });
});
