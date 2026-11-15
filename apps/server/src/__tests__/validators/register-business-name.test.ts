/** registerSchema: el nombre del negocio viaja en mails oficiales, así que se acota y se limpia. */
import { describe, it, expect } from 'vitest';
import { registerSchema } from '../../validators/auth';

const base = { email: 'a@example.com', password: 'Clave1234', name: 'Ana' };
const parse = (businessName: string) => registerSchema.safeParse({ ...base, businessName });

describe('registerSchema.businessName', () => {
  it('acepta un nombre normal (con tildes, números, símbolos comunes) y lo recorta', () => {
    const r = parse("  Peluquería D'Sol & Hijos 2  ");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.businessName).toBe("Peluquería D'Sol & Hijos 2");
  });

  it('acepta exactamente 80 caracteres y rechaza 81', () => {
    expect(parse('a'.repeat(80)).success).toBe(true);
    expect(parse('a'.repeat(81)).success).toBe(false);
  });

  it('rechaza saltos de línea (inyección de cabeceras / texto de phishing en varias líneas)', () => {
    expect(parse('Banco\nBcc: x@y.com').success).toBe(false);
    expect(parse('Banco\r\nAlerta').success).toBe(false);
    expect(parse('Banco Alerta').success).toBe(false);
  });

  it('rechaza caracteres de control y de formato (bidi override, ancho cero)', () => {
    expect(parse('Banco\u0007').success).toBe(false);
    expect(parse('Banco‮tfel').success).toBe(false);
    expect(parse('Ban​co').success).toBe(false);
  });
});
