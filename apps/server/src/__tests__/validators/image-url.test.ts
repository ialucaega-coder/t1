import { describe, it, expect } from 'vitest';
import { imageUrlSchema, sortOrderSchema, MAX_IMAGE_URL_LENGTH } from '../../validators/image-url';
import { updateProductSchema } from '../../validators/products';

describe('imageUrlSchema', () => {
  it('acepta una URL https y la recorta', () => {
    expect(imageUrlSchema.parse('  https://cdn.example.com/a.png?x=1 ')).toBe('https://cdn.example.com/a.png?x=1');
  });

  it('rechaza esquemas no https, URLs con credenciales y texto que no es URL', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:image/png;base64,AAAA',
      'http://x.com/a.png',
      'https://user:pass@x.com/a.png',
      'no-es-una-url',
      '',
    ]) {
      expect(imageUrlSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('rechaza URLs más largas que el máximo', () => {
    const long = 'https://x.com/' + 'a'.repeat(MAX_IMAGE_URL_LENGTH);
    expect(imageUrlSchema.safeParse(long).success).toBe(false);
  });
});

describe('sortOrderSchema', () => {
  it('solo acepta enteros acotados', () => {
    expect(sortOrderSchema.safeParse(0).success).toBe(true);
    expect(sortOrderSchema.safeParse(2.5).success).toBe(false);
    expect(sortOrderSchema.safeParse(-1).success).toBe(false);
    expect(sortOrderSchema.safeParse(1e9).success).toBe(false);
  });
});

describe('updateProductSchema', () => {
  it('un PUT parcial no inventa defaults (stock, isActive, sortOrder)', () => {
    expect(updateProductSchema.parse({ name: 'X' })).toEqual({ name: 'X' });
  });
});
