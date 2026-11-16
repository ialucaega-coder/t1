/**
 * Reservas: editar/reprogramar con el mismo modal del alta, y cancelar/eliminar
 * detrás de un ConfirmDialog, mostrando el error real del server.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const toast = vi.fn();
const updateBooking = vi.fn();
const deleteBooking = vi.fn();
const updateStatus = vi.fn();
const createBooking = vi.fn();
const refetch = vi.fn();
let role: 'ADMIN' | 'PROFESSIONAL' | 'CLIENT' = 'ADMIN';

const apiBooking = {
  id: 'b1',
  date: '2030-01-10T00:00:00.000Z',
  startTime: '10:00',
  endTime: '10:30',
  status: 'CONFIRMED',
  source: 'WEB',
  totalPrice: 1000,
  client: { id: 'c1', name: 'María' },
  professional: { id: 'prof_1', user: { name: 'Ana' } },
  service: { id: 'svc_1', name: 'Corte', duration: 30, price: 1000 },
};

vi.mock('@/hooks/use-bookings', () => ({
  useBookings: () => ({
    bookings: [apiBooking], isLoading: false, error: null, refetch,
    createBooking, updateStatus, updateBooking, deleteBooking,
  }),
}));
vi.mock('@/hooks/use-socket', () => ({ useSocket: () => {}, useSocketEvent: () => {} }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ business: { id: 'biz' }, user: { role } }) }));
vi.mock('@/lib/api/bookings', () => ({ exportCsv: vi.fn() }));
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/stores/page-counter', () => ({ usePageCounter: () => {}, fmtCounter: () => '' }));
vi.mock('@/components/bookings/BookingList', () => ({
  BookingList: ({ bookings, onSelect }: { bookings: { id: string; client: string }[]; onSelect: (b: unknown) => void }) => (
    <button onClick={() => onSelect(bookings[0])}>abrir-{bookings[0]?.client}</button>
  ),
}));
vi.mock('@/components/bookings/BookingCalendar', () => ({ BookingCalendar: () => null }));
vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ isOpen, title, children }: { isOpen: boolean; title: string; children: React.ReactNode }) =>
    isOpen ? <div><h2>{title}</h2>{children}</div> : null,
}));
vi.mock('@/components/bookings/BookingFormModal', () => ({
  BookingFormModal: ({ isOpen, booking, onSubmit }: { isOpen: boolean; booking?: { id: string } | null; onSubmit: (d: unknown) => Promise<void> }) =>
    isOpen && booking ? (
      <div data-testid="edit-form">
        editando:{booking.id}
        <button
          onClick={() =>
            onSubmit({ serviceId: 'svc_1', professionalId: 'prof_1', date: '2030-01-12', startTime: '15:00', notes: 'nueva nota' }).catch(() => {})
          }
        >
          guardar
        </button>
      </div>
    ) : null,
}));

import ReservasPage from '@/app/(dashboard)/reservas/page';

async function openDetail() {
  render(<ReservasPage />);
  fireEvent.click(screen.getByText('abrir-María'));
  await screen.findByText('Detalle de reserva');
}

beforeEach(() => {
  vi.clearAllMocks();
  role = 'ADMIN';
  updateBooking.mockResolvedValue(apiBooking);
  deleteBooking.mockResolvedValue(undefined);
  updateStatus.mockResolvedValue(undefined);
});

describe('ReservasPage: editar / reprogramar', () => {
  it('"Editar / reprogramar" abre el modal en modo edición y guarda con PATCH de la reserva', async () => {
    await openDetail();
    fireEvent.click(screen.getByRole('button', { name: /Editar \/ reprogramar/ }));

    expect(await screen.findByTestId('edit-form')).toHaveTextContent('editando:b1');
    fireEvent.click(screen.getByText('guardar'));

    await waitFor(() =>
      expect(updateBooking).toHaveBeenCalledWith('b1', {
        date: '2030-01-12',
        startTime: '15:00',
        serviceId: 'svc_1',
        professionalId: 'prof_1',
        notes: 'nueva nota',
      })
    );
    expect(refetch).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('si el server rechaza la reprogramación no anuncia éxito', async () => {
    updateBooking.mockRejectedValue(new Error('Ese horario ya está reservado para el profesional.'));
    await openDetail();
    fireEvent.click(screen.getByRole('button', { name: /Editar \/ reprogramar/ }));
    fireEvent.click(await screen.findByText('guardar'));

    await waitFor(() => expect(updateBooking).toHaveBeenCalled());
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('un CLIENT no ve el botón de editar', async () => {
    role = 'CLIENT';
    await openDetail();
    expect(screen.queryByRole('button', { name: /Editar \/ reprogramar/ })).toBeNull();
  });
});

describe('ReservasPage: cancelar y eliminar con confirmación', () => {
  it('"Cancelar" pide confirmación y recién al confirmar cancela', async () => {
    await openDetail();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Cancelar reserva');
    expect(updateStatus).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar reserva' }));
    await waitFor(() => expect(updateStatus).toHaveBeenCalledWith('b1', 'CANCELLED'));
  });

  it('"Volver" en la confirmación no cancela nada', async () => {
    await openDetail();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Volver' }));

    expect(updateStatus).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('"Eliminar" (ADMIN) pide confirmación y recién al confirmar borra', async () => {
    await openDetail();
    fireEvent.click(screen.getByRole('button', { name: /Eliminar/ }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Esta acción no se puede deshacer');
    expect(deleteBooking).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(deleteBooking).toHaveBeenCalledWith('b1'));
  });

  it('si el server falla al eliminar muestra el mensaje real y deja el diálogo abierto', async () => {
    deleteBooking.mockRejectedValue(new Error('Registro no encontrado'));
    await openDetail();
    fireEvent.click(screen.getByRole('button', { name: /Eliminar/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar' }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith({ type: 'error', message: 'Registro no encontrado' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('un PROFESSIONAL no ve "Eliminar" (el DELETE es solo de ADMIN)', async () => {
    role = 'PROFESSIONAL';
    await openDetail();
    expect(screen.queryByRole('button', { name: /Eliminar/ })).toBeNull();
  });
});
