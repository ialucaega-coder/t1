import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { patchSchema } from '../../validators/patch';

const create = z.object({
  name: z.string().min(1),
  category: z.string().default('General'),
  isActive: z.boolean().default(true),
});

describe('patchSchema', () => {
  const patch = patchSchema(create);

  it('no agrega defaults: un PUT con solo el nombre no pisa el resto', () => {
    expect(patch.parse({ name: 'Nuevo' })).toEqual({ name: 'Nuevo' });
  });

  it('acepta el objeto vacío', () => {
    expect(patch.parse({})).toEqual({});
  });

  it('respeta los valores enviados y sigue validando', () => {
    expect(patch.parse({ isActive: false })).toEqual({ isActive: false });
    expect(patch.safeParse({ name: '' }).success).toBe(false);
  });
});
