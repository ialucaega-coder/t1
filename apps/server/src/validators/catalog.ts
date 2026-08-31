import { z } from 'zod';

export const updateCatalogItemSchema = z.object({
  subtitle: z.string().min(1).max(120).optional(),
  description: z.string().min(1).max(600).optional(),
  iconName: z.string().min(1).max(80).optional(),
  isActive: z.boolean().optional(),
});

export const createPromptSchema = z.object({
  name: z.string().min(1).max(120),
  category: z.string().min(1).max(80).default('General'),
  content: z.string().min(1).max(4000),
  isActive: z.boolean().default(true),
});

export const updatePromptSchema = createPromptSchema.partial();

export type UpdateCatalogItemInput = z.infer<typeof updateCatalogItemSchema>;
export type CreatePromptInput = z.infer<typeof createPromptSchema>;
export type UpdatePromptInput = z.infer<typeof updatePromptSchema>;
