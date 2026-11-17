import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['**/__tests__/**', 'src/index.ts'],
      reportOnFailure: true,
      // Piso mínimo: la CI falla si la cobertura baja de acá (medido 2026-11-16:
      // server 86/83/88/86, web 43/74/43/43). Subirlo a medida que crece.
      thresholds: {
        statements: 80, branches: 75, functions: 80, lines: 80,
      },
    },
  },
});
