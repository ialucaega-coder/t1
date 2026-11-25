/**
 * /facturacion: cancelar la suscripción pide confirmación, el error se informa
 * con un toast y el descuento anual sale de los precios del plan (no hardcodeado).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const toastMock = vi.fn();
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock('@/components/billing/CheckoutButton', () => ({ CheckoutButton: () => <button>checkout</button> }));
vi.mock('@/components/billing/PlanUsage', () => ({ PlanUsage: () => <div /> }));

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api', () => ({
  httpClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
}));

import FacturacionPage from '@/app/(dashboard)/facturacion/page';

const plan = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  name: 'Pro',
  tier: 'PRO',
  priceMonthly: 100,
  priceYearly: 960, // 100 * 12 = 1200 -> 20% menos
  currency: 'ARS',
  maxBots: 1,
  maxMessages: 1000,
  maxContacts: 100,
  features: [],
  ...over,
});

const activeSub = {
  id: 's1',
  status: 'ACTIVE',
  currentPeriodStart: '2026-01-01T00:00:00.000Z',
  currentPeriodEnd: '2026-02-01T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  plan: plan(),
};

function mockData(plans: unknown[], sub: unknown = activeSub) {
  get.mockImplementation((url: string) => {
    if (url === '/billing/plans') return Promise.resolve(plans);
    if (url === '/billing/subscription') return Promise.resolve(sub);
    return Promise.resolve([]);
  });
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  toastMock.mockReset();
});

describe('facturacion: cancelar suscripción', () => {
  it('no cancela hasta confirmar', async () => {
    mockData([plan()]);
    post.mockResolvedValue({ ...activeSub, cancelAtPeriodEnd: true });
    render(<FacturacionPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar suscripción' }));
    expect(post).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: 'Sí, cancelar suscripción' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/billing/cancel', {}));
  });

  it('si falla la cancelación muestra un toast de error', async () => {
    mockData([plan()]);
    post.mockRejectedValue(new Error('Falló el gateway'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<FacturacionPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar suscripción' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sí, cancelar suscripción' }));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: 'Falló el gateway' })),
    );
  });
});

describe('facturacion: descuento anual', () => {
  it('lo calcula desde los precios del plan', async () => {
    mockData([plan()]);
    render(<FacturacionPage />);
    expect(await screen.findByText('-20%')).toBeInTheDocument();
  });

  it('refleja un descuento distinto (no queda fijo en -20%)', async () => {
    mockData([plan({ priceYearly: 900 })]); // 25%
    render(<FacturacionPage />);
    expect(await screen.findByText('-25%')).toBeInTheDocument();
    expect(screen.queryByText('-20%')).not.toBeInTheDocument();
  });

  it('sin precios que comparar no muestra porcentaje', async () => {
    mockData([plan({ priceMonthly: 0, priceYearly: 0 })]);
    render(<FacturacionPage />);
    await screen.findByText('Anual');
    expect(screen.queryByText(/^-\d+%$/)).not.toBeInTheDocument();
  });
});
