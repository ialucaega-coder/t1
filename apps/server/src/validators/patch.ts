import { z } from 'zod';

type StripDefault<F> = F extends z.ZodDefault<infer Inner> ? Inner : F;

type PatchShape<S extends z.ZodRawShape> = {
  [K in keyof S]: z.ZodOptional<StripDefault<S[K]>>;
};

/**
 * Esquema de actualización parcial (PATCH/PUT): todos los campos opcionales y SIN
 * valores por defecto. En zod 4, `.partial()` conserva los `.default()` y un PUT
 * con solo el nombre pisaría el resto de los campos con sus defaults.
 */
export function patchSchema<S extends z.ZodRawShape>(schema: z.ZodObject<S>) {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(schema.shape)) {
    const inner = field instanceof z.ZodDefault ? field.unwrap() : field;
    shape[key] = (inner as z.ZodType).optional();
  }
  return z.object(shape) as unknown as z.ZodObject<PatchShape<S>>;
}
