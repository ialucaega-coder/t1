import { describe, it, expect } from 'vitest';
import { fallbackTimeSlots, slotsForDuration, slotsOccupiedBy } from '@/components/bookings/slots';

describe('bookings/slots', () => {
  it('las franjas de respaldo son de 30 min entre 08:00 y 20:00', () => {
    const slots = fallbackTimeSlots();
    expect(slots[0]).toBe('08:00');
    expect(slots[1]).toBe('08:30');
    expect(slots[slots.length - 1]).toBe('20:00');
    expect(slots).toHaveLength(25);
  });

  it('un servicio de 30 min conserva todas las franjas libres', () => {
    expect(slotsForDuration(['09:00', '09:30', '11:00'], 30)).toEqual(['09:00', '09:30', '11:00']);
  });

  it('un servicio de 60 min solo deja las franjas con la siguiente también libre', () => {
    expect(slotsForDuration(['09:00', '09:30', '11:00'], 60)).toEqual(['09:00']);
  });

  it('un servicio de 90 min necesita 3 franjas consecutivas', () => {
    expect(slotsForDuration(['09:00', '09:30', '10:00', '10:30'], 90)).toEqual(['09:00', '09:30']);
  });

  it('slotsOccupiedBy lista las franjas que ocupa un turno', () => {
    expect(slotsOccupiedBy('10:00', '11:00')).toEqual(['10:00', '10:30']);
    expect(slotsOccupiedBy('10:00', '10:30')).toEqual(['10:00']);
  });
});
