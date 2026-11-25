import { test, expect } from '@playwright/test';
import { iniciarSesion, irA, vigilarErrores, esperarSinErrorBoundary } from './helpers';

const RUTAS = ['/dashboard', '/clientes', '/productos', '/servicios'];

test.describe('Navegación general (panel autenticado)', () => {
  test('las rutas principales cargan sin error fatal', async ({ page }) => {
    const errores = vigilarErrores(page);
    await iniciarSesion(page);

    for (const ruta of RUTAS) {
      await test.step(`carga ${ruta}`, async () => {
        const res = await irA(page, ruta);
        expect(res?.status(), `status de ${ruta}`).toBeLessThan(400);
        await expect(page).toHaveURL(new RegExp(`${ruta}$`)); // no redirigió a /login
        await esperarSinErrorBoundary(page);
      });
    }

    expect(errores, `pageerror: ${errores.join(' | ')}`).toEqual([]);
  });
});
