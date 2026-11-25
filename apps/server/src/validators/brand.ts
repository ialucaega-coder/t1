import { z } from 'zod';

/**
 * Esquema de validación para actualizar la Voz de Marca (PUT /api/brand).
 * Todos los campos son opcionales: se hace merge parcial con lo ya guardado.
 */
export const updateBrandVoiceSchema = z.object({
  tono: z.string().max(500).optional(),
  publicoObjetivo: z.string().max(500).optional(),
  infoNegocio: z.string().max(5000).optional(),
  reglas: z.string().max(2000).optional(),
  emojis: z.boolean().optional(),
});

export type UpdateBrandVoiceInput = z.infer<typeof updateBrandVoiceSchema>;
