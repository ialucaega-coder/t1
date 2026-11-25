import { z } from 'zod';

/**
 * URL pública (redes sociales, sitio web): solo https, sin credenciales embebidas.
 * `z.string().url()` acepta también `javascript:`, `data:` y `ftp:`, que acabarían
 * como `href` en páginas públicas del negocio.
 */
export const httpsUrlSchema = z
  .string()
  .trim()
  .max(500, 'La URL no puede superar los 500 caracteres')
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password;
    } catch {
      return false;
    }
  }, 'Debe ser una URL https válida');
