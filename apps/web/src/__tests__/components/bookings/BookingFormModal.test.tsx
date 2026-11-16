import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const getAvailability = vi.fn();
vi.mock('@/lib/api/services', () => ({
  getServices: () =>
    Promise.resolve([
      { id: 'svc_30', name: 'Corte', duration: 30, price: 1000, isActive: true },
      { id: 'svc_60', name: 'Color', duration: 60, price: 3000, isActive: true },
    ]),
}));
vi.mock('@/lib/api/professionals', () => ({
  getProfessionals: () => Promise.resolve([{ id: 'prof_1', user: { name: 'Ana' } }]),
  getAvailability: (...args: unknown[]) => getAvailability(...args),
}));
vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ isOpen, title, children }: { isOpen: boolean; title: string; children: React.ReactNode }) =>
    isOpen ? <div><h2>{title}</h2>{children}</div> : null,
}));

import { BookingFormModal } from '@/components/bookings/BookingFormModal';
import type { Booking } from '@/types';

const hourOptions = () =>
  Array.from((screen.getByText('Seleccionar hora').parentElement as HTMLSelectElement).options).map((o) => o.value);

const existingBooking: Booking = {
  id: 'b1',
  date: '2030-01-10T00:00:00.000Z',
  startTime: '10:00',
  endTime: '10:30',
  status: 'CONFIRMED',
  source: 'WEB',
  notes: 'traer foto',
  totalPrice: 1000,
  client: { id: 'c1', name: 'María' },
  professional: { id: 'prof_1', user: { name: 'Ana' } },
  service: { id: 'svc_30', name: 'Corte', duration: 30, price: 1000 },
};

beforeEach(() => {
  vi.clearAllMocks();
  getAvailability.mockResolvedValue({ available: true, slots: ['09:00', '09:30', '10:30', '11:00', '11:30'] });
});

describe('BookingFormModal: hora inicial', () => {
  it('preselecciona initialTime aunque el modal ya estuviera montado y cerrado', async () => {
    const props = { onClose: vi.fn(), onSubmit: vi.fn(), initialDate: '2030-01-10' };
    const { rerender } = render(<BookingFormModal {...props} isOpen={false} />);
    rerender(<BookingFormModal {...props} isOpen={true} initialTime="14:00" />);
    await waitFor(() => expect(screen.getByDisplayValue('14:00')).toBeInTheDocument());
  });
});

describe('BookingFormModal: franjas según horario del profesional y duración del servicio', () => {
  it('muestra solo las franjas libres del profesional que entran para la duración del servicio', async () => {
    render(<BookingFormModal isOpen onClose={vi.fn()} onSubmit={vi.fn()} initialDate="2030-01-10" />);
    await waitFor(() => expect(screen.getByText('Servicio *')).toBeInTheDocument());

    const [serviceSelect, professionalSelect] = screen.getAllByRole('combobox');
    fireEvent.change(serviceSelect, { target: { value: 'svc_60' } });
    fireEvent.change(professionalSelect, { target: { value: 'prof_1' } });

    // 60 min: solo arrancan en franjas con la siguiente libre (09:00, 10:30 y 11:00).
    await waitFor(() => expect(hourOptions()).toEqual(['', '09:00', '10:30', '11:00']));
    expect(getAvailability).toHaveBeenCalledWith('prof_1', '2030-01-10');
  });

  it('si el profesional no tiene horario ese día mantiene las franjas de 30 min y avisa', async () => {
    getAvailability.mockResolvedValue({ available: false, slots: [] });
    render(<BookingFormModal isOpen onClose={vi.fn()} onSubmit={vi.fn()} initialDate="2030-01-10" />);
    await waitFor(() => expect(screen.getByText('Servicio *')).toBeInTheDocument());

    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'prof_1' } });

    expect(await screen.findByText(/no tiene horario de atención ese día/)).toBeInTheDocument();
    expect(hourOptions()).toContain('08:00');
    expect(hourOptions()).toContain('20:00');
  });

  it('si falla la carga del horario mantiene las franjas de 30 min y avisa', async () => {
    getAvailability.mockRejectedValue(new Error('boom'));
    render(<BookingFormModal isOpen onClose={vi.fn()} onSubmit={vi.fn()} initialDate="2030-01-10" />);
    await waitFor(() => expect(screen.getByText('Servicio *')).toBeInTheDocument());

    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'prof_1' } });

    expect(await screen.findByText(/No se pudo cargar el horario/)).toBeInTheDocument();
    expect(hourOptions()).toContain('08:30');
  });
});

describe('BookingFormModal: alta', () => {
  it('muestra el mensaje real del server si el alta falla (no uno genérico)', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Ese horario ya está reservado para el profesional.'));
    render(<BookingFormModal isOpen onClose={vi.fn()} onSubmit={onSubmit} initialDate="2030-01-10" initialTime="09:00" />);
    await waitFor(() => expect(screen.getByText('Servicio *')).toBeInTheDocument());

    const [serviceSelect, professionalSelect] = screen.getAllByRole('combobox');
    fireEvent.change(serviceSelect, { target: { value: 'svc_30' } });
    fireEvent.change(professionalSelect, { target: { value: 'prof_1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear reserva' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Ese horario ya está reservado para el profesional.');
    // El origen válido para el server (el viejo "MANUAL" no existe en el enum y daba 400).
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ source: 'WALK_IN' }));
  });
});

describe('BookingFormModal: edición / reprogramación', () => {
  it('abre en modo edición con los datos de la reserva precargados', async () => {
    render(<BookingFormModal isOpen onClose={vi.fn()} onSubmit={vi.fn()} booking={existingBooking} />);

    expect(await screen.findByText('Editar reserva')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByDisplayValue('2030-01-10')).toBeInTheDocument());
    expect(screen.getByDisplayValue('traer foto')).toBeInTheDocument();
    expect(screen.getByDisplayValue('10:00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeInTheDocument();
    expect(screen.queryByText('Datos del cliente (opcional)')).toBeNull();
  });

  it('el propio turno cuenta como libre al reprogramar (misma fecha y profesional)', async () => {
    render(<BookingFormModal isOpen onClose={vi.fn()} onSubmit={vi.fn()} booking={existingBooking} />);

    // La disponibilidad no incluye 10:00 (lo ocupa este mismo turno): igual debe poder elegirse.
    await waitFor(() => expect(hourOptions()).toContain('09:30'));
    expect(hourOptions()).toContain('10:00');
    expect(hourOptions()).not.toContain('10:00 (no disponible)');
  });

  it('guarda los cambios (fecha, hora y notas) con onSubmit y cierra', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<BookingFormModal isOpen onClose={onClose} onSubmit={onSubmit} booking={existingBooking} />);
    await waitFor(() => expect(hourOptions()).toContain('11:00'));

    fireEvent.change(screen.getByDisplayValue('10:00'), { target: { value: '11:00' } });
    fireEvent.change(screen.getByDisplayValue('traer foto'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        serviceId: 'svc_30',
        professionalId: 'prof_1',
        date: '2030-01-10',
        startTime: '11:00',
        notes: '',
      })
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('si el server rechaza la reprogramación muestra su mensaje y no cierra', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Ese horario ya está reservado para el profesional.'));
    const onClose = vi.fn();
    render(<BookingFormModal isOpen onClose={onClose} onSubmit={onSubmit} booking={existingBooking} />);
    await waitFor(() => expect(hourOptions()).toContain('11:00'));

    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Ese horario ya está reservado para el profesional.');
    expect(onClose).not.toHaveBeenCalled();
  });
});
