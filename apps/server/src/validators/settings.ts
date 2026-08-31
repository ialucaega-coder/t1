import { z } from 'zod';

export const updateSettingsSchema = z.object({
  businessName: z.string().min(1).max(120).optional(),
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug invalido')
    .optional(),
  phone: z.string().max(40).optional(),
  email: z.string().email().max(160).optional().or(z.literal('')),
  address: z.string().max(240).optional(),
  timezone: z.string().min(1).max(80).optional(),
  currency: z.string().min(3).max(3).optional(),
  theme: z.string().min(1).max(40).optional(),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  aiProviders: z.array(z.string().min(1).max(80)).max(8).optional(),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
