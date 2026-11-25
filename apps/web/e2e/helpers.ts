import { expect, type Page, type Request } from '@playwright/test';

export const DEMO_EMAIL = 'admin@localb.com';
export const DEMO_PASSWORD = 'admin123';

/** Inicia sesión por la UI y espera la redirección a /dashboard. */
export async function iniciarSesion(page: Page) {
  await page.goto('/login');
  await esperarHidratacion(page);
  await page.getByPlaceholder('tu@email.com').fill(DEMO_EMAIL);
  await page.getByPlaceholder('••••••••').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/**
 * Registra errores "fatales" de la página: excepciones no capturadas (pageerror).
 * Los console.error de red (4xx/5xx de recursos, CORS) NO se consideran fatales.
 */
export function vigilarErrores(page: Page) {
  const errores: string[] = [];
  page.on('pageerror', (e) => errores.push(e.message));
  return errores;
}

/** Verifica que no se mostró el error boundary de Next. */
export async function esperarSinErrorBoundary(page: Page) {
  await expect(page.getByText('Error en el panel')).toHaveCount(0);
  await expect(page.getByText('Algo salió mal')).toHaveCount(0);
}

/**
 * Navega (page.goto) a una ruta protegida y espera a que AuthProvider termine
 * de validar la sesión (GET /api/auth/me), incluyendo TODAS las llamadas en vuelo.
 *
 * Por qué: si un test navega a otra ruta mientras /auth/me sigue en vuelo, el fetch
 * se cancela, el `.catch` de auth-context llama a logout() y borra el token
 * (localStorage + cookie auth_token) -> la siguiente navegación rebota a /login.
 * En dev (React StrictMode) /auth/me se dispara DOS veces y el backend tarda varios
 * segundos, así que no alcanza con esperar la primera respuesta.
 * (Ver "hallazgos" en el reporte: es una fragilidad real de auth-context.tsx.)
 */
export async function irA(page: Page, ruta: string) {
  let vistas = 0;
  let enVuelo = 0;
  const esMe = (r: Request) => r.url().includes('/api/auth/me') && r.method() === 'GET';
  const alIniciar = (r: Request) => { if (esMe(r)) { vistas++; enVuelo++; } };
  const alTerminar = (r: Request) => { if (esMe(r)) enVuelo--; };
  page.on('request', alIniciar);
  page.on('requestfinished', alTerminar);
  page.on('requestfailed', alTerminar);
  try {
    const res = await page.goto(ruta);
    await expect.poll(() => vistas > 0 && enVuelo === 0, { timeout: 45_000, message: `/auth/me no terminó al cargar ${ruta}` }).toBe(true);
    return res;
  } finally {
    page.off('request', alIniciar);
    page.off('requestfinished', alTerminar);
    page.off('requestfailed', alTerminar);
  }
}

/**
 * Espera a que React hidrate el formulario. Si se hace click en "Iniciar sesión" antes
 * de la hidratación, el <form> se envía nativo (GET /login) y la página se recarga con los
 * campos vacíos -> test intermitente (sobre todo con el dev server compilando on-demand).
 */
export async function esperarHidratacion(page: Page) {
  await page.waitForFunction(() => {
    const form = document.querySelector('form');
    return !!form && Object.keys(form).some((k) => k.startsWith('__reactProps'));
  });
}
