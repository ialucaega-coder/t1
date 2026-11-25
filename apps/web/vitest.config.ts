import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    // Una sola copia de React en los tests (evita el mismatch react@19 /
    // react-dom hoisteado). La versión única la garantiza el `overrides` del
    // package.json raíz (react/react-dom 19.3.0).
    dedupe: ['react', 'react-dom'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'json-summary'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['**/__tests__/**', '.next/**'],
      reportOnFailure: true,
      // Piso mínimo: la CI falla si la cobertura baja de acá (medido 2026-11-16:
      // server 86/83/88/86, web 43/74/43/43). Subirlo a medida que crece.
      thresholds: {
        statements: 38, branches: 65, functions: 38, lines: 38,
      },
    },
  },
});
