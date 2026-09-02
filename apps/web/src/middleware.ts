import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * middleware.ts
 * ------------------------------------------------------------------
 * Middleware de Next.js (se ejecuta en el edge, antes de renderizar
 * cualquier página) responsable de:
 *
 *   1. Redirigir usuarios NO autenticados que intenten acceder a
 *      /dashboard/* hacia /login.
 *   2. Redirigir usuarios YA autenticados que visiten /login o
 *      /register de vuelta a /dashboard.
 *   3. Agregar cabeceras de seguridad a todas las respuestas.
 *
 * IMPORTANTE sobre autenticación:
 * El frontend guarda el JWT en localStorage (ver
 * apps/web/src/lib/api/http-client.ts), pero el middleware corre en
 * el servidor/edge y NO tiene acceso a localStorage. Por eso,
 * http-client.ts refleja el token en una cookie liviana
 * ("auth_token", no httpOnly) cada vez que se hace login/logout.
 * Este middleware solo verifica la PRESENCIA de esa cookie para
 * decidir si redirige o no: es una comprobación de UX, no de
 * seguridad. La autorización real siempre se valida en el backend
 * (verificación de firma JWT en cada endpoint de la API).
 * ------------------------------------------------------------------
 */

const AUTH_COOKIE_NAME = 'auth_token';

// Todas las rutas que viven bajo el route group "(dashboard)" de la
// app (ver apps/web/src/app/(dashboard)/*). Next.js no incluye el
// nombre del route group en la URL, por lo que hay que listar cada
// segmento real explícitamente. "/dashboard" es el enunciado en el
// requerimiento original, pero el resto del panel privado usa el
// mismo esquema de protección.
const PROTECTED_PREFIXES = [
  '/dashboard',
  '/agencia',
  '/analisis',
  '/arena',
  '/clientes',
  '/comandos',
  '/conexiones',
  '/configuracion',
  '/equipo',
  '/estadisticas',
  '/facturacion',
  '/habilidades',
  '/ia',
  '/marketplace',
  '/novedades',
  '/plantillas',
  '/plantillas-negocio',
  '/pos',
  '/productos',
  '/prompt',
  '/reservas',
  '/servicios',
  '/superpoderes',
  '/whitelabel',
];
const AUTH_ONLY_PATHS = ['/login', '/register'];

function hasSessionCookie(request: NextRequest): boolean {
  const cookie = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  return Boolean(cookie && cookie.length > 0);
}

/** Aplica cabeceras de seguridad estándar a la respuesta saliente. */
function applySecurityHeaders(response: NextResponse, pathname: string): NextResponse {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  const isEmbeddable = pathname.startsWith('/chat/') || pathname.startsWith('/book/');
  response.headers.set('X-Frame-Options', isEmbeddable ? 'SAMEORIGIN' : 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    'geolocation=(), camera=(), microphone=(), payment=(), usb=()'
  );
  // Solo forzamos HSTS en producción (HTTPS); en desarrollo rompería
  // la navegación local por HTTP.
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
  return response;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const authenticated = hasSessionCookie(request);

  const isProtectedRoute = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  const isAuthOnlyRoute = AUTH_ONLY_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );

  if (isProtectedRoute && !authenticated) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return applySecurityHeaders(NextResponse.redirect(loginUrl), pathname);
  }

  if (isAuthOnlyRoute && authenticated) {
    return applySecurityHeaders(NextResponse.redirect(new URL('/dashboard', request.url)), pathname);
  }

  return applySecurityHeaders(NextResponse.next(), pathname);
}

export const config = {
  // Excluye assets estáticos y de Next internos para no penalizar
  // el rendimiento con ejecuciones innecesarias del middleware.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
