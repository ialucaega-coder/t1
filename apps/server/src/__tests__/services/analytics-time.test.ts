/**
 * Días calendario en hora de Argentina (services/analytics/time.ts).
 */
import { describe, it, expect } from 'vitest';
import { arDateKey, arDayKeys, arDayStartUtc, arWeekdayLabel } from '../../services/analytics/time';

describe('services/analytics/time', () => {
  it('arDateKey usa la fecha de Argentina, no la de UTC', () => {
    // 01:00 UTC del 2/11 = 22:00 del 1/11 en Argentina.
    expect(arDateKey(new Date('2026-11-02T01:00:00Z'))).toBe('2026-11-01');
    // 03:00 UTC es la medianoche de Argentina: ya es el día siguiente.
    expect(arDateKey(new Date('2026-11-02T03:00:00Z'))).toBe('2026-11-02');
    expect(arDateKey(new Date('2026-11-02T02:59:59Z'))).toBe('2026-11-01');
  });

  it('arDayKeys devuelve N días, el más viejo primero y hoy al final', () => {
    expect(arDayKeys(3, new Date('2026-11-02T01:00:00Z'))).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
  });

  it('arDayKeys cruza cambios de mes y de año', () => {
    expect(arDayKeys(3, new Date('2027-01-01T12:00:00Z'))).toEqual(['2026-12-30', '2026-12-31', '2027-01-01']);
    expect(arDayKeys(2, new Date('2028-03-01T12:00:00Z'))).toEqual(['2028-02-29', '2028-03-01']);
  });

  it('arDayStartUtc: el día empieza a las 03:00 UTC', () => {
    expect(arDayStartUtc('2026-10-26').toISOString()).toBe('2026-10-26T03:00:00.000Z');
  });

  it('arWeekdayLabel no depende de la zona horaria del servidor', () => {
    // 1/11/2026 es domingo.
    expect(arWeekdayLabel('2026-11-01').toLowerCase()).toMatch(/^dom/);
  });
});
