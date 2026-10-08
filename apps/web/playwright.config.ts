import { defineConfig, devices } from '@playwright/test';

/**
 * Config de Playwright para los E2E "smoke" de Local B.
 *
 * Requisitos (dev servers):
 *   - Web:    npm run dev --workspace=web      (http://localhost:3000)
 *   - Server: npm run dev --workspace=server   (http://localhost:4000)
 *   - DB seedeada con el usuario demo admin@localb.com / admin123.
 *
 * Si el web ya está corriendo se reutiliza (reuseExistingServer). Si no,
 * Playwright lo levanta. El server (Express + Prisma + DB) hay que levantarlo
 * a mano porque depende de la DB y del .env del dueño.
 *
 * Correr: npm run test:e2e --workspace=web
 */
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000, // el dev server compila cada ruta on-demand: la 1ra visita es lenta
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1, // un solo worker: Next dev compila on-demand y el login tiene rate limit
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'es-AR',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run dev --workspace=web',
      cwd: '../..',
      url: BASE_URL,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
