import { z } from 'zod';

/**
 * Normaliza un email: recorta espacios y lo convierte a minúsculas.
 * Evita cuentas duplicadas por diferencias de mayúsculas (ej:
 * "Usuario@Mail.com" vs "usuario@mail.com") y asegura que el
 * rate limiting / bloqueo de cuenta por intentos fallidos se aplique
 * de forma consistente sin importar cómo el usuario escriba su email.
 */
const normalizedEmail = z
  .string()
  .email()
  .transform((email) => email.trim().toLowerCase());

/**
 * Validación de fortaleza de contraseña: mínimo 8 caracteres y al
 * menos una mayúscula, una minúscula y un número. Se aplica tanto en
 * el registro como en cualquier flujo futuro de cambio de contraseña.
 */
export const passwordSchema = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres')
  .regex(/[a-z]/, 'La contraseña debe incluir al menos una letra minúscula')
  .regex(/[A-Z]/, 'La contraseña debe incluir al menos una letra mayúscula')
  .regex(/[0-9]/, 'La contraseña debe incluir al menos un número');

/** Datos requeridos para registrar un nuevo negocio y su usuario administrador. */
export const registerSchema = z.object({
  email: normalizedEmail,
  password: passwordSchema,
  name: z.string().min(2).trim(),
  businessName: z.string().min(2).trim(),
});

/** Credenciales de inicio de sesión. */
export const loginSchema = z.object({
  email: normalizedEmail,
  // En login no se re-valida la fortaleza (podría romper cuentas
  // creadas antes de esta política); solo se exige que no esté vacía.
  password: z.string().min(1),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
