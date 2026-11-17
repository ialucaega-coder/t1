/**
 * Log de acceso HTTP (morgan 'dev') sin secretos en la URL.
 *
 * El token de lectura del chat público (y cualquier `token=`/`access_token=`)
 * puede viajar en la query; morgan imprime la URL completa y los logs de la
 * plataforma (Cloud Run) la guardan. Se redefine el token `url` de morgan para
 * redactar esos valores antes de loguear.
 */
import morgan from 'morgan';
import type { IncomingMessage } from 'http';

const SECRET_QUERY_RE = /([?&](?:token|chatToken|access_token|api_key)=)[^&#]*/gi;

/** Reemplaza el valor de los parámetros de query sensibles por `[redacted]`. */
export function redactUrl(url: string): string {
  return url.replace(SECRET_QUERY_RE, '$1[redacted]');
}

morgan.token('url', (req: IncomingMessage & { originalUrl?: string }) =>
  redactUrl(req.originalUrl || req.url || ''),
);

export const accessLogger = morgan('dev');
