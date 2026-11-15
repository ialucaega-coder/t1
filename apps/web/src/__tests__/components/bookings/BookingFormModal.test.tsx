import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('@/lib/api/services', () => ({ getServices: () => Promise.resolve([]) }));
vi.mock('@/lib/api/professionals', () => ({ getProfessionals: () => Promise.resolve([]) }));
vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) => (isOpen ? <div>{children}</div> : null),
}));

import { BookingFormModal } from '@/components/bookings/BookingFormModal';

describe('BookingFormModal: hora inicial', () => {
  it('preselecciona initialTime aunque el modal ya estuviera montado y cerrado', async () => {
    const props = { onClose: vi.fn(), onSubmit: vi.fn(), initialDate: '2030-01-10' };
    const { rerender } = render(<BookingFormModal {...props} isOpen={false} />);
    rerender(<BookingFormModal {...props} isOpen={true} initialTime="14:00" />);
    await waitFor(() => expect(screen.getByDisplayValue('14:00')).toBeInTheDocument());
  });
});
