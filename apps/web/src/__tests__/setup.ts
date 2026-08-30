/**
 * Configuracion global de pruebas para el frontend (Next.js + React).
 *
 * Se ejecuta una vez antes de la suite (ver `setupFiles` en vitest.config.ts).
 * Agrega los matchers de jest-dom, limpia el DOM entre tests con Testing
 * Library y resetea mocks para que un test no contamine al siguiente.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

// jsdom no implementa navigator.clipboard por defecto.
if (!('clipboard' in navigator)) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    writable: true,
    configurable: true,
  });
}
