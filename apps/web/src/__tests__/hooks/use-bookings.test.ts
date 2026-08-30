/**
 * Pruebas unitarias para el hook `useBookings` (`src/hooks/use-bookings.ts`):
 * carga de datos, estados de loading/error, fallback a mock y operaciones CRUD.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

// Mock del modulo de API antes de importar el hook
vi.mock('@/lib/api/index', () => ({
  bookingsApi: {
    getBookings: vi.fn(),
    createBooking: vi.fn(),
    updateBookingStatus: vi.fn(),
  },
}));

import { useBookings } from '@/hooks/use-bookings';
import { bookingsApi } from '@/lib/api/index';
import { MOCK_BOOKINGS } from '@/constants/bookings';

const mockGetBookings = bookingsApi.getBookings as ReturnType<typeof vi.fn>;
const mockCreateBooking = bookingsApi.createBooking as ReturnType<typeof vi.fn>;
const mockUpdateStatus = bookingsApi.updateBookingStatus as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hooks/use-bookings', () => {
  it('inicia en estado de carga', () => {
    mockGetBookings.mockReturnValue(new Promise(() => {})); // nunca se resuelve
    const { result } = renderHook(() => useBookings());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.bookings).toEqual([]);
  });

  it('carga las reservas correctamente desde la API', async () => {
    const fakeBookings = [{ id: '1', date: '2025-01-01', status: 'CONFIRMED' }];
    mockGetBookings.mockResolvedValue(fakeBookings);

    const { result } = renderHook(() => useBookings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.bookings).toEqual(fakeBookings);
    expect(result.current.error).toBeNull();
  });

  it('usa datos mock como fallback cuando la API falla', async () => {
    mockGetBookings.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useBookings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Network error');
    expect(result.current.bookings.length).toBe(MOCK_BOOKINGS.length);
  });

  it('pasa la fecha como parametro a la API', async () => {
    mockGetBookings.mockResolvedValue([]);

    renderHook(() => useBookings('2025-06-15'));

    await waitFor(() => expect(mockGetBookings).toHaveBeenCalledWith({ date: '2025-06-15' }));
  });

  it('no pasa parametros cuando no se especifica fecha', async () => {
    mockGetBookings.mockResolvedValue([]);

    renderHook(() => useBookings());

    await waitFor(() => expect(mockGetBookings).toHaveBeenCalledWith(undefined));
  });

  it('refetch recarga las reservas', async () => {
    mockGetBookings.mockResolvedValue([]);

    const { result } = renderHook(() => useBookings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockGetBookings).toHaveBeenCalledTimes(1);

    const newData = [{ id: '99', status: 'PENDING' }];
    mockGetBookings.mockResolvedValue(newData);

    act(() => {
      result.current.refetch();
    });

    await waitFor(() => expect(result.current.bookings).toEqual(newData));
    expect(mockGetBookings).toHaveBeenCalledTimes(2);
  });

  it('createBooking agrega la reserva creada a la lista', async () => {
    mockGetBookings.mockResolvedValue([]);
    const created = { id: 'new-1', status: 'PENDING' };
    mockCreateBooking.mockResolvedValue(created);

    const { result } = renderHook(() => useBookings());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let returned: unknown;
    await act(async () => {
      returned = await result.current.createBooking({ serviceId: 's1', date: '2025-01-01', startTime: '10:00' } as any);
    });

    expect(returned).toEqual(created);
    expect(result.current.bookings).toContainEqual(created);
  });

  it('createBooking devuelve null y setea error cuando falla', async () => {
    mockGetBookings.mockResolvedValue([]);
    mockCreateBooking.mockRejectedValue(new Error('Conflicto de horario'));

    const { result } = renderHook(() => useBookings());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let returned: unknown;
    await act(async () => {
      returned = await result.current.createBooking({} as any);
    });

    expect(returned).toBeNull();
    expect(result.current.error).toBe('Conflicto de horario');
  });

  it('updateStatus actualiza la reserva en la lista', async () => {
    const original = { id: 'b1', status: 'PENDING' };
    mockGetBookings.mockResolvedValue([original]);
    const updated = { id: 'b1', status: 'CONFIRMED' };
    mockUpdateStatus.mockResolvedValue(updated);

    const { result } = renderHook(() => useBookings());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.updateStatus('b1', 'CONFIRMED');
    });

    expect(result.current.bookings[0].status).toBe('CONFIRMED');
  });

  it('updateStatus setea error cuando falla', async () => {
    mockGetBookings.mockResolvedValue([{ id: 'b1', status: 'PENDING' }]);
    mockUpdateStatus.mockRejectedValue(new Error('Sin permiso'));

    const { result } = renderHook(() => useBookings());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.updateStatus('b1', 'CONFIRMED');
    });

    expect(result.current.error).toBe('Sin permiso');
  });

  it('setea mensaje generico cuando el error no es instancia de Error', async () => {
    mockGetBookings.mockRejectedValue('string error');

    const { result } = renderHook(() => useBookings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Error al cargar reservas');
  });
});
