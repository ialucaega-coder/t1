import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

/**
 * security.ts
 * ------------------------------------------------------------------
 * Middlewares de seguridad complementarios para la API de Local B.
 *
 * Helmet ya cubre gran parte de las cabeceras HTTP estándar (CSP,
 * HSTS, X-Frame-Options, etc). Este archivo agrega:
 *   1. Protección CSRF (patrón "double submit cookie")
 *   2. Saneamiento de inputs contra XSS (sin dependencias externas)
 *   3. Cabeceras de seguridad adicionales no cubiertas por Helmet
 *   4. Validación estricta del tamaño de las peticiones
 * ------------------------------------------------------------------
 */

// ============================================================
// 1. Protección CSRF (Cross-Site Request Forgery)
// ============================================================
//
// La API es consumida principalmente con tokens Bearer (JWT en el
// header Authorization), lo que ya mitiga CSRF clásico porque el
// navegador no adjunta ese header automáticamente en peticiones
// cross-site. Sin embargo, si se usan cookies (por ejemplo, la
// cookie httpOnly opcional emitida en /auth/login), agregamos una
// defensa "double submit cookie": el cliente debe reenviar el valor
// de la cookie CSRF en un header personalizado. Si ambos no
// coinciden, la petición se rechaza.

export const CSRF_COOKIE_NAME = 'csrf_token';
export const CSRF_HEADER_NAME = 'x-csrf-token';

const CSRF_SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Genera un token CSRF criptográficamente seguro y lo expone en una
 * cookie legible por JavaScript (no httpOnly, ya que el cliente debe
 * poder leerlo para reenviarlo en el header). Se debe invocar en
 * rutas públicas (por ejemplo, al servir el login) o en cada
 * respuesta si aún no existe la cookie.
 */
export function issueCsrfToken(req: Request, res: Response, next: NextFunction) {
  const existing = req.cookies?.[CSRF_COOKIE_NAME];
  if (!existing) {
    const token = crypto.randomBytes(32).toString('hex');
    res.cookie(CSRF_COOKIE_NAME, token, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 24 * 60 * 60 * 1000, // 24 horas
    });
  }
  next();
}

/**
 * Verifica el token CSRF en peticiones que mutan estado
 * (POST/PUT/PATCH/DELETE) cuando la autenticación se realiza por
 * cookie. Las peticiones autenticadas exclusivamente con Bearer
 * token (sin cookie de sesión) quedan exentas, ya que no son
 * vulnerables al vector clásico de CSRF.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  if (CSRF_SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const hasSessionCookie = Boolean(req.cookies?.session_token);
  if (!hasSessionCookie) {
    // Autenticación vía Bearer token: no aplica el patrón CSRF clásico.
    next();
    return;
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = req.headers[CSRF_HEADER_NAME];

  if (
    !cookieToken ||
    !headerToken ||
    typeof headerToken !== 'string' ||
    !timingSafeEqual(cookieToken, headerToken)
  ) {
    res.status(403).json({ error: 'Token CSRF inválido o ausente' });
    return;
  }

  next();
}

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ============================================================
// 2. Saneamiento de inputs (anti-XSS, sin dependencias externas)
// ============================================================
//
// Elimina etiquetas <script>, manejadores de eventos inline
// (onclick=, onerror=, etc), esquemas "javascript:" y "data:text/html"
// de todas las cadenas presentes en body, query y params. No
// reemplaza a la validación de esquema (Zod), pero reduce la
// superficie de ataque para XSS almacenado/reflejado.

const EVENT_HANDLER_RE = /\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const JS_PROTOCOL_RE = /javascript\s*:/gi;
const DATA_HTML_RE = /data\s*:\s*text\/html/gi;

/**
 * Quita secuencias tipo `<...>` (etiquetas HTML, incluido <script> y atributos
 * como onerror=) en UNA sola pasada O(n). Reemplaza a las regex anteriores
 * `<script[\s\S]*?>...` (O(n³)) y `<\/?[a-z][^>]*>` (O(n²)), que tenían
 * backtracking catastrófico: un body con miles de `<script` o `<a` sin cierre
 * bloqueaba el event loop por segundos/minutos (ReDoS, DoS sin autenticación).
 * Un `<` sin su `>` de cierre se deja literal (React lo escapa al renderizar).
 */
function stripTagsLinear(value: string): string {
  let out = '';
  let i = 0;
  const n = value.length;
  while (i < n) {
    const lt = value.indexOf('<', i);
    if (lt === -1) { out += value.slice(i); break; }
    out += value.slice(i, lt); // texto antes del '<'
    const next = value[lt + 1];
    // Solo tratamos el '<' como inicio de etiqueta si lo sigue algo de etiqueta
    // real (letra, '/', '!' o '?'). Así "x < 5 y > 3" o "<3" NO se corrompen
    // (antes se borraba cualquier `<...>`, comiéndose texto y secretos legítimos).
    if (!next || !/[a-zA-Z/!?]/.test(next)) {
      out += '<';
      i = lt + 1;
      continue;
    }
    const gt = value.indexOf('>', lt + 1);
    if (gt === -1) { out += value.slice(lt); break; } // '<' sin cierre: literal
    i = gt + 1; // saltar la etiqueta
  }
  return out;
}

/**
 * Sanea una cadena de texto individual eliminando marcado peligroso.
 * Es intencionalmente conservador: no intenta ser un parser HTML
 * completo, solo elimina los vectores XSS más comunes. Todas las operaciones
 * son de tiempo lineal (sin regex con backtracking catastrófico).
 */
export function sanitizeString(value: string): string {
  let out = stripTagsLinear(value);
  out = out.replace(EVENT_HANDLER_RE, '');
  out = out.replace(JS_PROTOCOL_RE, '');
  out = out.replace(DATA_HTML_RE, '');
  return out;
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 10) return value; // evita recursión excesiva / DoS
  if (typeof value === 'string') {
    return sanitizeString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1));
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = sanitizeValue(val, depth + 1);
    }
    return result;
  }
  return value;
}

/**
 * Middleware que sanea recursivamente req.body y req.query.
 * Debe ejecutarse ANTES de la validación con Zod para que los
 * esquemas trabajen sobre datos ya limpios.
 */
export function sanitizeRequest(req: Request, _res: Response, next: NextFunction) {
  // El body crudo del webhook de Stripe llega como Buffer (para verificar
  // la firma) y no debe pasar por el saneo recursivo, que lo destruiría.
  if (Buffer.isBuffer(req.body)) {
    return next();
  }
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeValue(req.body);
  }
  if (req.query && typeof req.query === 'object') {
    // req.query es de solo lectura en algunos tipados; se muta en el lugar.
    const sanitizedQuery = sanitizeValue(req.query) as Record<string, unknown>;
    for (const key of Object.keys(req.query)) {
      delete (req.query as Record<string, unknown>)[key];
    }
    Object.assign(req.query as Record<string, unknown>, sanitizedQuery);
  }
  next();
}

// ============================================================
// 3. Cabeceras de seguridad adicionales (más allá de Helmet)
// ============================================================

export function extraSecurityHeaders(_req: Request, res: Response, next: NextFunction) {
  // Restringe el acceso a APIs sensibles del navegador (geolocalización,
  // cámara, micrófono, etc). Helmet no define Permissions-Policy por defecto.
  res.setHeader(
    'Permissions-Policy',
    'geolocation=(), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()'
  );

  // Evita que otros orígenes incrusten recursos de esta API.
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');

  // Aísla el contexto de navegación para mitigar ataques Spectre-like.
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');

  // Desactiva el cacheo de respuestas potencialmente sensibles en proxies
  // intermedios y en el navegador (las respuestas de la API son dinámicas).
  res.setHeader('Cache-Control', 'no-store');

  // Refuerza que el navegador no intente adivinar el tipo de contenido.
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Reduce la información de referer enviada a otros orígenes.
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  next();
}

// ============================================================
// 4. Validación de tamaño de la petición
// ============================================================

interface RequestSizeOptions {
  /** Tamaño máximo del cuerpo en bytes (por defecto 1 MB). */
  maxBodyBytes?: number;
  /** Longitud máxima permitida para una URL/query string. */
  maxUrlLength?: number;
}

const DEFAULT_MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MB
const DEFAULT_MAX_URL_LENGTH = 2048;

/**
 * Valida que el tamaño de la petición esté dentro de límites
 * razonables antes de que el body-parser procese el contenido.
 * Complementa (no reemplaza) el límite configurado en
 * express.json({ limit: ... }).
 */
export function validateRequestSize(options: RequestSizeOptions = {}) {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const maxUrlLength = options.maxUrlLength ?? DEFAULT_MAX_URL_LENGTH;

  return (req: Request, res: Response, next: NextFunction) => {
    if (req.originalUrl.length > maxUrlLength) {
      res.status(414).json({ error: 'URI demasiado larga' });
      return;
    }

    const contentLengthHeader = req.headers['content-length'];
    if (contentLengthHeader) {
      const contentLength = Number(contentLengthHeader);
      if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
        res.status(413).json({ error: 'Payload demasiado grande' });
        return;
      }
    }

    next();
  };
}
