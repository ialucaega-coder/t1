import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/hooks/use-bookings', () => ({
  useBookings: () => ({
    bookings: [], isLoading: false, error: null, refetch: vi.fn(),
    createBooking: vi.fn(), updateStatus: vi.fn(),
  }),
}));
vi.mock('@/hooks/use-socket', () => ({ useSocket: () => {}, useSocketEvent: () => {} }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ business: { id: 'b1' } }) }));
vi.mock('@/lib/api/bookings', () => ({ exportCsv: vi.fn() }));
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/stores/page-counter', () => ({ usePageCounter: () => {}, fmtCounter: () => '' }));
vi.mock('@/components/bookings/BookingList', () => ({ BookingList: () => null }));
vi.mock('@/components/bookings/BookingDetailModal', () => ({ BookingDetailModal: () => null }));
vi.mock('@/components/bookings/BookingCalendar', () => ({
  BookingCalendar: ({ onSlotClick }: { onSlotClick: (t: string) => void }) => (
    <button onClick={() => onSlotClick('14:00')}>slot-14</button>
  ),
}));
vi.mock('@/components/bookings/BookingFormModal', () => ({
  BookingFormModal: ({ isOpen, initialTime }: { isOpen: boolean; initialTime?: string }) =>
    isOpen ? <div data-testid="form">hora:{initialTime ?? 'ninguna'}</div> : null,
}));

import ReservasPage from '@/app/(dashboard)/reservas/page';

describe('ReservasPage: franja del calendario', () => {
  it('pasa la hora tocada como initialTime', () => {
    render(<ReservasPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Calendario' }));
    fireEvent.click(screen.getByText('slot-14'));
    expect(screen.getByTestId('form')).toHaveTextContent('hora:14:00');
  });

  it('el botón "Nueva reserva" abre sin hora precargada', () => {
    render(<ReservasPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Calendario' }));
    fireEvent.click(screen.getByText('slot-14'));
    fireEvent.click(screen.getByRole('button', { name: /Nueva reserva/i }));
    expect(screen.getByTestId('form')).toHaveTextContent('hora:ninguna');
  });
});
