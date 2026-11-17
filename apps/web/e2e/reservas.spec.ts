import { test, expect } from '@playwright/test';
import { iniciarSesion, irA, vigilarErrores, esperarSinErrorBoundary } from './helpers';

test.describe('Reservas', () => {
  test('carga la lista y permite cambiar al calendario sin errores', async ({ page }) => {
    const errores = vigilarErrores(page);
    await iniciarSesion(page);

    await irA(page, '/reservas');
    await expect(page).toHaveURL(/\/reservas/);

    // Controles de la página visibles (vista lista/calendario + botón de alta)
    await expect(page.getByRole('button', { name: 'Lista' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Calendario' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Nueva reserva/ })).toBeVisible();

    // Termina de cargar (el spinner desaparece) y se muestra el contador del pie
    await expect(page.getByText('Cargando reservas...')).toHaveCount(0);
    await expect(page.getByText(/^\d+ reservas?$/)).toBeVisible();

    await page.getByRole('button', { name: 'Calendario' }).click();
    await expect(page.getByText('Cargando reservas...')).toHaveCount(0);

    await esperarSinErrorBoundary(page);
    expect(errores, `pageerror: ${errores.join(' | ')}`).toEqual([]);
  });
});
