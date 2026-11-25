import { describe, it, expect } from 'vitest';
import { AppError } from '../../middleware/errorHandler';
import {
  HH_MM_REGEX,
  bookingDateKey,
  bookingInstant,
  computeEndTime,
  overlaps,
  timeToMinutes,
} from '../../services/bookings/time';
import { csvCell } from '../../services/bookings/csv';

describe('services/bookings/time', () => {
  it('HH_MM_REGEX acepta 00:00 a 23:59 y rechaza 99:99, 24:00, 12:60 y formatos cortos', () => {
    for (const ok of ['00:00', '09:30', '23:59']) expect(HH_MM_REGEX.test(ok)).toBe(true);
    for (const bad of ['99:99', '24:00', '12:60', '9:00', '100:00', '10:5']) expect(HH_MM_REGEX.test(bad)).toBe(false);
  });

  it('overlaps compara en minutos enteros (no en orden lexicográfico)', () => {
    // '9:30' > '10:00' como string, pero 9:30 cae dentro de 9:00-10:00.
    expect(overlaps({ startTime: '09:30', endTime: '10:00' }, { startTime: '9:00', endTime: '10:00' })).toBe(true);
    expect(overlaps({ startTime: '100:00', endTime: '100:30' }, { startTime: '20:00', endTime: '21:00' })).toBe(false);
    // Turnos contiguos no se pisan; el fin de día 24:00 se interpreta bien.
    expect(overlaps({ startTime: '10:00', endTime: '10:30' }, { startTime: '10:30', endTime: '11:00' })).toBe(false);
    expect(overlaps({ startTime: '23:30', endTime: '24:00' }, { startTime: '23:00', endTime: '24:00' })).toBe(true);
    expect(timeToMinutes('24:00')).toBe(1440);
  });

  it('computeEndTime: suma la duración, permite terminar a las 24:00 y rechaza cruzar la medianoche', () => {
    expect(computeEndTime('10:00', 45)).toBe('10:45');
    expect(computeEndTime('23:00', 60)).toBe('24:00');
    expect(() => computeEndTime('23:00', 61)).toThrow(AppError);
  });

  it('computeEndTime: duración de 1 a 1440 enteros y hora de inicio válida', () => {
    expect(() => computeEndTime('10:00', 0)).toThrow(/duración/);
    expect(() => computeEndTime('10:00', 1441)).toThrow(/duración/);
    expect(() => computeEndTime('10:00', 1.5)).toThrow(/duración/);
    expect(computeEndTime('00:00', 1440)).toBe('24:00');
    expect(() => computeEndTime('99:99', 30)).toThrow(/inicio/);
  });

  it('bookingDateKey normaliza a YYYY-MM-DD y lanza 400 con una fecha inválida', () => {
    expect(bookingDateKey('2026-01-05')).toBe('2026-01-05');
    expect(bookingDateKey('2026-01-05T15:30:00.000Z')).toBe('2026-01-05');
    expect(() => bookingDateKey('nope')).toThrow(AppError);
  });

  it('bookingInstant arma el instante con offset de Argentina (-03:00)', () => {
    expect(bookingInstant('2026-01-05', '10:00').toISOString()).toBe('2026-01-05T13:00:00.000Z');
    expect(bookingInstant('2026-01-05T00:00:00.000Z', '22:30').toISOString()).toBe('2026-01-06T01:30:00.000Z');
  });
});

describe('services/bookings/csv', () => {
  it('prefija comilla simple a las celdas peligrosas y escapa comillas dobles', () => {
    expect(csvCell('=1+1')).toBe(`"'=1+1"`);
    expect(csvCell('+54911')).toBe(`"'+54911"`);
    expect(csvCell('-2')).toBe(`"'-2"`);
    expect(csvCell('@x')).toBe(`"'@x"`);
    expect(csvCell('\tx')).toBe(`"'\tx"`);
    expect(csvCell('\rx')).toBe(`"'\rx"`);
    expect(csvCell('a "b"')).toBe('"a ""b"""');
    expect(csvCell('normal')).toBe('"normal"');
    expect(csvCell(undefined)).toBe('""');
  });
});
