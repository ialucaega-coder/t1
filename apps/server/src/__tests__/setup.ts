/**
 * Configuracion global de pruebas para el backend (Express + Prisma).
 *
 * Este archivo se ejecuta una vez antes de correr la suite de tests
 * (ver `setupFiles` en vitest.config.ts). Se encarga de:
 *  - Definir variables de entorno necesarias para que los modulos que
 *    dependen de `process.env` (JWT, etc.) no fallen al importarse.
 *  - Limpiar mocks entre tests para evitar fugas de estado.
 */
import { afterEach, vi } from 'vitest';

// A NIVEL DE MÓDULO (no en beforeAll): los `setupFiles` se ejecutan antes de
// importar los archivos de test, así que esto garantiza que el secreto ya esté
// presente cuando un test lee `process.env` en el tope de su módulo (p. ej.
// `const OLD_ENV = { ...process.env }` o `jwt.sign(..., NEXTAUTH_SECRET)`).
// En beforeAll llegaba tarde y antes quedaba enmascarado por el viejo fallback
// 'dev-secret', que ya fue eliminado por seguridad.
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});
