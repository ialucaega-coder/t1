/**
 * Resolución central de secretos del server.
 *
 * Antes, cada punto que necesitaba el secreto JWT hacía
 * `process.env.NEXTAUTH_SECRET || 'dev-secret'`. Ese fallback es un agujero
 * crítico: si el server arranca sin `NEXTAUTH_SECRET` (p. ej. un staging mal
 * configurado, o Railway sin `NODE_ENV`), firma y valida tokens con un secreto
 * PÚBLICO y conocido, y cualquiera puede forjar un JWT ADMIN de cualquier
 * negocio.
 *
 * Acá eliminamos el fallback: si el secreto falta o es uno de los valores
 * inseguros por defecto, se tira error — en CUALQUIER entorno, no solo en
 * producción. Mejor caer al arrancar/primer uso que servir con un secreto
 * falsificable.
 */

/** Valores que nunca deben aceptarse como secreto real. */
const INSECURE_SECRETS = new Set(['', 'dev-secret', 'your-secret-here', 'changeme']);

function assertStrong(value: string | undefined, name: string): string {
  if (!value || INSECURE_SECRETS.has(value)) {
    throw new Error(
      `${name} no está configurado o usa un valor inseguro por defecto. ` +
        `Definí un secreto fuerte en .env antes de arrancar el server.`
    );
  }
  return value;
}

/**
 * Secreto para firmar/verificar los JWT de sesión. Lanza si falta o es inseguro.
 * Se llama por request (no en el tope del módulo) para fallar de forma perezosa
 * y testeable.
 */
export function getAuthSecret(): string {
  return assertStrong(process.env.NEXTAUTH_SECRET, 'NEXTAUTH_SECRET');
}

/**
 * Secreto para cifrado en reposo (AES-256-GCM del secreto TOTP, HMAC del OTP).
 * Prioriza `ENCRYPTION_KEY`; si no está, deriva del secreto de auth (que a su
 * vez debe ser válido). Nunca cae a un valor por defecto.
 */
export function getEncryptionSecret(): string {
  const dedicated = process.env.ENCRYPTION_KEY;
  if (dedicated && !INSECURE_SECRETS.has(dedicated)) return dedicated;
  return getAuthSecret();
}

/**
 * Validación al arranque: fuerza a resolver el secreto de auth una vez, para
 * fallar rápido si el entorno está mal configurado (en vez de en el primer
 * login). Se llama desde `index.ts`.
 */
export function assertSecretsConfigured(): void {
  getAuthSecret();
}
