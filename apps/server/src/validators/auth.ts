import { z } from 'zod';
import { businessNameSchema } from './common';

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
  // Tope de largo: sin él, un atacante puede enviar contraseñas enormes y gastar
  // CPU/memoria en el hash (Argon2id) en cada intento.
  .max(128, 'La contraseña no puede superar los 128 caracteres')
  .regex(/[a-z]/, 'La contraseña debe incluir al menos una letra minúscula')
  .regex(/[A-Z]/, 'La contraseña debe incluir al menos una letra mayúscula')
  .regex(/[0-9]/, 'La contraseña debe incluir al menos un número');

/** Datos requeridos para registrar un nuevo negocio y su usuario administrador. */
export const registerSchema = z.object({
  email: normalizedEmail,
  password: passwordSchema,
  name: z.string().min(2).trim(),
  // El nombre del negocio se muestra en mails que salen del dominio oficial (invitaciones):
  // se acota y se rechazan saltos de línea y caracteres de control/formato (bidi, etc.).
  businessName: businessNameSchema(2),
});

/** Credenciales de inicio de sesión. */
export const loginSchema = z.object({
  email: normalizedEmail,
  // En login no se re-valida la fortaleza (podría romper cuentas
  // creadas antes de esta política); solo se exige que no esté vacía. El tope de
  // largo evita gastar CPU/memoria hasheando inputs gigantes en cada intento.
  password: z.string().min(1).max(128),
  // Código TOTP de 2FA. Opcional: solo se exige si la cuenta tiene 2FA activo
  // (el login responde twoFactorRequired si falta).
  twoFactorCode: z.string().trim().optional(),
});

/** Código TOTP de 6 dígitos para los endpoints de 2FA. */
export const twoFactorCodeSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'El código debe tener 6 dígitos'),
});

/**
 * Segundo factor en /2fa/disable y /2fa/recovery-codes: un código TOTP de 6
 * dígitos O un código de recuperación (10 caracteres, con o sin guion). Así quien
 * perdió el celular puede igual desactivar o rearmar su 2FA.
 */
export const secondFactorCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^(\d{6}|[A-Za-z0-9]{5}-?[A-Za-z0-9]{5})$/, 'Ingresá el código de 6 dígitos o un código de recuperación'),
});

/**
 * Canje de una invitación al equipo. La contraseña sigue la MISMA política que el
 * registro (passwordSchema). El token solo se acota en largo: su formato se valida
 * en el servicio y cualquier problema responde el mismo error genérico.
 */
export const acceptInviteSchema = z.object({
  token: z.string().min(1).max(200),
  name: z.string().trim().min(2, 'Ingresá tu nombre').max(100),
  password: passwordSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
