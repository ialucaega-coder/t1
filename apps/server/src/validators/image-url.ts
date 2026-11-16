import { z } from 'zod';

/** Largo máximo razonable para una URL de imagen. */
export const MAX_IMAGE_URL_LENGTH = 2048;

/**
 * URL de imagen de un producto/servicio: solo https (se rechazan http, data:,
 * javascript:, file:, etc.), sin credenciales embebidas y de hasta 2048 caracteres.
 * Se renderiza en un <img> del dashboard y de los canales públicos, así que no
 * aceptamos nada que no sea una URL web segura.
 */
export const imageUrlSchema = z
  .string()
  .trim()
  .max(MAX_IMAGE_URL_LENGTH, `La URL de la imagen no puede superar los ${MAX_IMAGE_URL_LENGTH} caracteres`)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password;
    } catch {
      return false;
    }
  }, 'La imagen debe ser una URL https válida');

/** Orden manual en el listado: entero acotado (el default 0 lo pone la base). */
export const sortOrderSchema = z.number().int().min(0).max(100000);
