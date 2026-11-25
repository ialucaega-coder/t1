import { z } from 'zod';
import { businessNameSchema } from './common';

/**
 * Slugs que el negocio no puede tomar: chocan con rutas de la app o suplantan
 * páginas del producto (`/api`, `/admin`, `/login`, ...).
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'api', 'admin', 'www', 'app', 'dashboard', 'login', 'register', 'signup', 'logout',
]);

/** ¿Es una zona horaria IANA que el runtime reconoce? */
function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Códigos ISO 4217 que el runtime conoce (si no puede listarlos, alcanza el formato). */
const SUPPORTED_CURRENCIES: ReadonlySet<string> | null = (() => {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('currency');
    return list && list.length > 0 ? new Set(list) : null;
  } catch {
    return null;
  }
})();

export const updateSettingsSchema = z.object({
  businessName: businessNameSchema(1).optional(),
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug invalido')
    .refine((s) => !RESERVED_SLUGS.has(s), 'Ese slug está reservado')
    .optional(),
  phone: z.string().max(40).optional(),
  email: z.string().email().max(160).optional().or(z.literal('')),
  address: z.string().max(240).optional(),
  timezone: z
    .string()
    .min(1)
    .max(80)
    .refine(isValidTimezone, 'Zona horaria inválida (ej: America/Argentina/Buenos_Aires)')
    .optional(),
  // ISO 4217: 3 letras mayúsculas ("ars" se normaliza a "ARS").
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'La moneda debe ser un código ISO de 3 letras (ej: ARS)')
    .refine((c) => !SUPPORTED_CURRENCIES || SUPPORTED_CURRENCIES.has(c), 'Moneda desconocida')
    .optional(),
  theme: z.string().min(1).max(40).optional(),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  aiProviders: z.array(z.string().min(1).max(80)).max(8).optional(),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
