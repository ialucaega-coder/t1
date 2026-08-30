/**
 * Pruebas de componente para `BookingCard` (`src/components/bookings/BookingCard.tsx`).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BookingCard } from '@/components/bookings/BookingCard';
import type { Booking, BookingStatus } from '@/constants/bookings';
import { BOOKING_STATUS_LABELS } from '@/constants/bookings';

function makeBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'b-1',
    client: 'María García',
    service: 'Corte + Peinado',
    professional: 'Ana López',
    time: '09:00',
    duration: 60,
    status: 'CONFIRMED',
    ...overrides,
  };
}

describe('components/bookings/BookingCard', () => {
  it('renderiza el nombre del cliente', () => {
    render(<BookingCard booking={makeBooking()} />);

    expect(screen.getByText('María García')).toBeInTheDocument();
  });

  it('renderiza la hora y la duracion', () => {
    render(<BookingCard booking={makeBooking({ time: '14:30', duration: 45 })} />);

    expect(screen.getByText('14:30')).toBeInTheDocument();
    expect(screen.getByText('45 MIN')).toBeInTheDocument();
  });

  it('muestra el servicio y el profesional', () => {
    render(<BookingCard booking={makeBooking({ service: 'Barba', professional: 'Carlos Ruiz' })} />);

    expect(screen.getByText(/Barba/)).toBeInTheDocument();
    expect(screen.getByText(/Carlos Ruiz/)).toBeInTheDocument();
  });

  it('muestra la etiqueta del estado de la reserva', () => {
    render(<BookingCard booking={makeBooking({ status: 'PENDING' })} />);

    expect(screen.getByText(BOOKING_STATUS_LABELS.PENDING)).toBeInTheDocument();
  });

  it.each<BookingStatus>(['CONFIRMED', 'PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'])(
    'renderiza correctamente con estado "%s"',
    (status) => {
      const { container } = render(<BookingCard booking={makeBooking({ status })} />);

      expect(screen.getByText(BOOKING_STATUS_LABELS[status])).toBeInTheDocument();
      expect(container.firstChild).toBeTruthy();
    }
  );

  it('combina servicio y profesional en una sola linea', () => {
    render(<BookingCard booking={makeBooking()} />);

    expect(screen.getByText('Corte + Peinado · con Ana López')).toBeInTheDocument();
  });
});
