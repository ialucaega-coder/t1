import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { iniciarSesion, irA, vigilarErrores, esperarSinErrorBoundary } from './helpers';

/**
 * Smoke de TODAS las pantallas del panel: visita cada ruta estática de
 * `src/app/(dashboard)` y falla ante una excepción no capturada (pageerror), un
 * status >= 400, un rebote a /login o el error boundary de Next.
 *
 * Las rutas salen del filesystem (no de una lista a mano), así una pantalla
 * nueva entra sola al smoke. Las dinámicas ([id]) se omiten: necesitan datos.
 */
function rutasDelPanel(): string[] {
  const raiz = path.resolve(process.cwd(), 'src/app/(dashboard)');
  const rutas: string[] = [];
  const recorrer = (dir: string, prefijo: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.includes('[')) continue;
      const sub = `${prefijo}/${e.name}`;
      if (fs.existsSync(path.join(dir, e.name, 'page.tsx'))) rutas.push(sub);
      recorrer(path.join(dir, e.name), sub);
    }
  };
  recorrer(raiz, '');
  return rutas.sort();
}

const RUTAS = rutasDelPanel();

test.describe('Smoke de pantallas del panel', () => {
  test('hay un número razonable de pantallas detectadas', () => {
    expect(RUTAS.length, `rutas: ${RUTAS.join(', ')}`).toBeGreaterThanOrEqual(30);
  });

  test('todas las pantallas cargan sin error fatal', async ({ page }) => {
    test.setTimeout(RUTAS.length * 40_000);
    const errores: string[] = [];
    const vigilar = vigilarErrores(page);
    await iniciarSesion(page);

    for (const ruta of RUTAS) {
      await test.step(`carga ${ruta}`, async () => {
        vigilar.length = 0;
        const res = await irA(page, ruta);
        expect(res?.status(), `status de ${ruta}`).toBeLessThan(400);
        await expect(page, `${ruta} no debe rebotar a /login`).not.toHaveURL(/\/login/);
        await esperarSinErrorBoundary(page);
        if (vigilar.length) errores.push(`${ruta}: ${vigilar.join(' | ')}`);
      });
    }

    expect(errores, `pageerror por pantalla:\n${errores.join('\n')}`).toEqual([]);
  });
});
