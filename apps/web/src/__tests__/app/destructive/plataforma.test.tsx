/** /plataforma: cambiar de plan y suspender un negocio piden confirmación. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const setBusinessPlan = vi.fn();
const setBusinessActive = vi.fn();
vi.mock('@/lib/api/platform', () => ({
  listBusinesses: vi.fn().mockResolvedValue({
    businesses: [
      {
        id: 'b1',
        name: 'Barbería Z',
        slug: 'barberia-z',
        isActive: true,
        createdAt: '2026-01-01',
        planTier: 'FREE',
        planName: 'Gratis',
        subscriptionStatus: null,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: null,
        usersCount: 1,
        botsCount: 1,
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
  }),
  setBusinessPlan: (...a: unknown[]) => setBusinessPlan(...a),
  setBusinessActive: (...a: unknown[]) => setBusinessActive(...a),
  getBusinessFeatures: vi.fn(),
  saveBusinessFeatures: vi.fn(),
}));

import PlataformaPage from '@/app/(dashboard)/plataforma/page';

beforeEach(() => {
  setBusinessPlan.mockReset();
  setBusinessActive.mockReset();
});

describe('plataforma: acciones sensibles', () => {
  it('elegir un plan en el select no lo cambia hasta confirmar', async () => {
    setBusinessPlan.mockResolvedValue({ planTier: 'PRO', planName: 'Pro', status: 'ACTIVE', cancelAtPeriodEnd: false });
    render(<PlataformaPage />);

    const select = await screen.findByRole('combobox');
    fireEvent.change(select, { target: { value: 'PRO' } });
    expect(setBusinessPlan).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: 'Cambiar plan' }));
    await waitFor(() => expect(setBusinessPlan).toHaveBeenCalledWith('b1', 'PRO'));
  });

  it('Suspender no suspende hasta confirmar', async () => {
    setBusinessActive.mockResolvedValue({ isActive: false });
    render(<PlataformaPage />);

    fireEvent.click(await screen.findByRole('button', { name: /Suspender/ }));
    expect(setBusinessActive).not.toHaveBeenCalled();

    const confirmButtons = await screen.findAllByRole('button', { name: 'Suspender' });
    // El del diálogo es el último (el de la fila queda detrás del overlay).
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);
    await waitFor(() => expect(setBusinessActive).toHaveBeenCalledWith('b1', false));
  });
});
