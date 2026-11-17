import { test, expect } from '@playwright/test';
import { DEMO_EMAIL, esperarHidratacion, iniciarSesion } from './helpers';

test.describe('Login', () => {
  test('login válido con usuario demo redirige a /dashboard y setea la cookie auth_token', async ({ page, context }) => {
    await iniciarSesion(page);
    await expect(page).toHaveURL(/\/dashboard$/);

    // El guard de rutas (proxy.ts) lee la COOKIE, no localStorage.
    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === 'auth_token')?.value).toBeTruthy();
    expect(await page.evaluate(() => localStorage.getItem('auth_token'))).toBeTruthy();
  });

  test('credenciales inválidas no inician sesión (permanece en /login sin cookie)', async ({ page, context }) => {
    await page.goto('/login');
    await esperarHidratacion(page);
    await page.getByPlaceholder('tu@email.com').fill(DEMO_EMAIL);
    await page.getByPlaceholder('••••••••').fill('clave-incorrecta-xyz');
    const respuesta = page.waitForResponse((r) => r.url().includes('/api/auth/login'));
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    expect((await respuesta).status()).toBe(401);

    await expect(page).toHaveURL(/\/login/);
    expect((await context.cookies()).find((c) => c.name === 'auth_token')).toBeUndefined();
  });

  // BUG DETECTADO: http-client.ts trata TODO 401 como sesión vencida y hace
  // window.location.href = '/login' (recarga dura), incluso en /auth/login. Resultado: con
  // credenciales incorrectas la página se recarga, se vacían los campos y el mensaje de error
  // del formulario ("Invalid credentials") NUNCA se ve. Habilitar cuando se corrija
  // (p. ej. no redirigir en 401 si la ruta es /auth/login).
  test.fixme('credenciales inválidas muestran mensaje de error en el formulario', async ({ page }) => {
    await page.goto('/login');
    await esperarHidratacion(page);
    await page.getByPlaceholder('tu@email.com').fill(DEMO_EMAIL);
    await page.getByPlaceholder('••••••••').fill('clave-incorrecta-xyz');
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    await expect(page.locator('div.text-red-400')).toBeVisible();
  });

  test('ruta protegida sin sesión redirige a /login con ?redirect', async ({ page }) => {
    await page.goto('/reservas');
    await expect(page).toHaveURL(/\/login\?redirect=%2Freservas/);
  });
});
