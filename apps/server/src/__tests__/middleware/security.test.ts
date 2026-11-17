/**
 * Pruebas del saneo de inputs anti-XSS (`src/middleware/security.ts`).
 * Incluye un test de REGRESIÓN de ReDoS: el saneo debe correr en tiempo lineal,
 * así que un payload patológico (miles de `<script`/`<a` sin cierre) tiene que
 * resolverse en milisegundos, no en segundos (antes bloqueaba el event loop).
 */
import { describe, it, expect } from 'vitest';
import { sanitizeString } from '../../middleware/security';

describe('middleware/security — sanitizeString', () => {
  it('quita etiquetas <script> (el contenido queda como texto inerte)', () => {
    const out = sanitizeString('hola <script>alert(1)</script> mundo');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('</script');
    expect(out).toContain('hola');
    expect(out).toContain('mundo');
  });

  it('quita etiquetas HTML y manejadores de eventos', () => {
    expect(sanitizeString('<img src=x onerror="alert(1)">')).not.toContain('<img');
    expect(sanitizeString('<b>hola</b>')).toBe('hola');
  });

  it('neutraliza protocolos peligrosos', () => {
    expect(sanitizeString('javascript:alert(1)')).not.toMatch(/javascript\s*:/i);
    expect(sanitizeString('data:text/html,<x>')).not.toMatch(/data\s*:\s*text\/html/i);
  });

  it('deja intacto el texto normal', () => {
    expect(sanitizeString('Juan Pérez')).toBe('Juan Pérez');
    expect(sanitizeString('precio > 100 y stock < 5')).toContain('precio');
  });

  it('un `<` sin cierre se deja literal (no se cuelga ni corrompe de más)', () => {
    expect(sanitizeString('a < b sin tag')).toContain('a < b sin tag');
  });

  it('no corrompe texto con < y > que NO son etiquetas (regresión M3)', () => {
    expect(sanitizeString('x < 5 y > 3')).toBe('x < 5 y > 3');
    expect(sanitizeString('<3 me encanta, 5 > 4')).toBe('<3 me encanta, 5 > 4');
    expect(sanitizeString('precio <= 100 >= 10')).toBe('precio <= 100 >= 10');
  });

  // --- Regresión ReDoS: debe ser lineal (resolverse en ms, no en segundos) ---
  it('no se cuelga con miles de <script sin cerrar (ex-O(n³))', () => {
    const payload = '<script'.repeat(20000); // ~140 KB
    const start = Date.now();
    sanitizeString(payload);
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('no se cuelga con miles de <a sin cerrar (ex-O(n²))', () => {
    const payload = '<a'.repeat(300000); // ~600 KB
    const start = Date.now();
    sanitizeString(payload);
    expect(Date.now() - start).toBeLessThan(500);
  });
});
