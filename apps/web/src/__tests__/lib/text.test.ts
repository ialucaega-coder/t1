/**
 * Pruebas de los helpers de texto para comparar (`src/lib/text.ts`): búsquedas
 * y filtros sin distinguir mayúsculas/tildes y mapeo de nombres de ícono.
 */
import { describe, it, expect } from 'vitest';
import { normalizeText, toKebabCase } from '@/lib/text';

describe('lib/text — normalizeText', () => {
  it('pasa a minúsculas y quita tildes', () => {
    expect(normalizeText('Gastronomía')).toBe('gastronomia');
    expect(normalizeText('Educación')).toBe('educacion');
    expect(normalizeText('Catálogo & Pedidos')).toBe('catalogo & pedidos');
  });

  it('hace que "Reserva" encuentre "/nueva-reserva" (búsqueda de comandos)', () => {
    expect(normalizeText('/nueva-reserva').includes(normalizeText('Reserva'))).toBe(true);
  });

  it('recorta espacios y tolera null/undefined', () => {
    expect(normalizeText('  Hola ')).toBe('hola');
    expect(normalizeText(null)).toBe('');
    expect(normalizeText(undefined)).toBe('');
  });
});

describe('lib/text — toKebabCase', () => {
  it('convierte PascalCase a kebab-case', () => {
    expect(toKebabCase('CreditCard')).toBe('credit-card');
    expect(toKebabCase('MessageSquare')).toBe('message-square');
    expect(toKebabCase('QrCode')).toBe('qr-code');
    expect(toKebabCase('Bell')).toBe('bell');
  });

  it('deja igual un kebab-case ya válido', () => {
    expect(toKebabCase('graduation-cap')).toBe('graduation-cap');
  });
});
