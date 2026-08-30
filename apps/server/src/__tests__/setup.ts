/**
 * Configuracion global de pruebas para el backend (Express + Prisma).
 *
 * Este archivo se ejecuta una vez antes de correr la suite de tests
 * (ver `setupFiles` en vitest.config.ts). Se encarga de:
 *  - Definir variables de entorno necesarias para que los modulos que
 *    dependen de `process.env` (JWT, etc.) no fallen al importarse.
 *  - Limpiar mocks entre tests para evitar fugas de estado.
 */
import { afterEach, beforeAll, vi } from 'vitest';

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret';
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});
