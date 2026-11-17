import { describe, it, expect } from 'vitest';
import { resolveRange, bookingWindowFilter, bookingPrevWindowFilter, windowFilter } from '../../services/analytics/range';

const NOW = new Date('2026-11-20T15:00:00.000Z');

describe('ventanas de Booking.date', () => {
  const range = resolveRange({ from: '2026-11-10', to: '2026-11-12' } as never, 30, NOW);

  it('bookingWindowFilter usa medianoche UTC: incluye el dia `from` y excluye el dia siguiente a `to`', () => {
    const w = bookingWindowFilter(range) as { gte: Date; lt: Date };
    expect(w.gte.toISOString()).toBe('2026-11-10T00:00:00.000Z');
    expect(w.lt.toISOString()).toBe('2026-11-13T00:00:00.000Z');
    const fromDay = new Date('2026-11-10'); // asi guarda Booking.date services/bookings/create.ts
    const nextDay = new Date('2026-11-13');
    expect(fromDay >= w.gte && fromDay < w.lt).toBe(true);
    expect(nextDay >= w.gte && nextDay < w.lt).toBe(false);
  });

  it('la ventana por createdAt (windowFilter, 03:00Z) dejaria fuera la reserva del dia `from`: por eso no sirve para Booking.date', () => {
    const w = windowFilter(range) as { gte: Date };
    expect(new Date('2026-11-10') >= w.gte).toBe(false);
  });

  it('bookingPrevWindowFilter es la ventana anterior de igual largo, tambien en medianoche UTC', () => {
    const w = bookingPrevWindowFilter(range);
    expect(w.gte.toISOString()).toBe('2026-11-07T00:00:00.000Z');
    expect(w.lt.toISOString()).toBe('2026-11-10T00:00:00.000Z');
  });
});
