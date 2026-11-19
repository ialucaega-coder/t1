import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const toast = vi.hoisted(() => vi.fn());
const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const portal = vi.hoisted(() => vi.fn());
const checkout = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({ httpClient: http }));
vi.mock('@/lib/api/billing', () => ({ createPortalSession: portal, createCheckoutSession: checkout }));
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/billing/PlanUsage', () => ({ PlanUsage: () => null }));

import FacturacionPage from '@/app/(dashboard)/facturacion/page';

const plans = [
  { id: 'p_free', name: 'Free', tier: 'FREE', priceMonthly: 0, priceYearly: 0, currency: 'USD', maxBots: 1, maxMessages: 100, maxContacts: 50, features: [] },
  { id: 'p_pro', name: 'Pro', tier: 'PRO', priceMonthly: 29, priceYearly: 290, currency: 'USD', maxBots: 5, maxMessages: 5000, maxContacts: 500, features: [] },
];

function sub(status: string) {
  return {
    id: 's1',
    status,
    currentPeriodStart: '2026-11-01T00:00:00Z',
    currentPeriodEnd: '2026-12-01T00:00:00Z',
    cancelAtPeriodEnd: false,
    plan: plans[0],
  };
}

function setup(subscription: ReturnType<typeof sub> | null) {
  http.get.mockImplementation(async (path: string) => {
    if (path === '/billing/plans') return plans;
    if (path === '/billing/subscription') return subscription;
    return [];
  });
}

describe('FacturacionPage: suscripción vigente', () => {
  beforeEach(() => {
    toast.mockReset();
    portal.mockReset();
    http.get.mockReset();
  });

  it('con suscripción ACTIVE muestra "Gestionar suscripción" y oculta "Cambiar plan"', async () => {
    setup(sub('ACTIVE'));
    render(<FacturacionPage />);
    expect(await screen.findByRole('button', { name: /Gestionar suscripción/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cambiar plan/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Elegir plan/ })).toBeNull();
  });

  it('"Gestionar suscripción" abre el portal y redirige a la URL devuelta', async () => {
    setup(sub('ACTIVE'));
    portal.mockResolvedValue({ url: 'https://billing.example.com/portal' });
    const loc = { href: '' };
    const original = window.location;
    Object.defineProperty(window, 'location', { value: loc, writable: true, configurable: true });
    try {
      render(<FacturacionPage />);
      fireEvent.click(await screen.findByRole('button', { name: /Gestionar suscripción/ }));
      await waitFor(() => expect(loc.href).toBe('https://billing.example.com/portal'));
    } finally {
      Object.defineProperty(window, 'location', { value: original, writable: true, configurable: true });
    }
  });

  it('si el portal falla muestra el mensaje real del server', async () => {
    setup(sub('ACTIVE'));
    portal.mockRejectedValue(new Error('No hay cliente de Stripe asociado. Suscribite primero.'));
    render(<FacturacionPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Gestionar suscripción/ }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({ type: 'error', message: 'No hay cliente de Stripe asociado. Suscribite primero.' }),
    );
  });

  it('PAST_DUE y TRIALING también usan el portal (el server rechaza el checkout con 409)', async () => {
    setup(sub('TRIALING'));
    render(<FacturacionPage />);
    expect(await screen.findByRole('button', { name: /Gestionar suscripción/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cambiar plan/ })).toBeNull();
  });

  it('muestra el estado real en español: TRIALING = "En prueba", PAST_DUE = "Pago pendiente"', async () => {
    setup(sub('TRIALING'));
    const { unmount } = render(<FacturacionPage />);
    expect(await screen.findByText('En prueba')).toBeInTheDocument();
    expect(screen.queryByText('Cancelada')).toBeNull();
    unmount();

    setup(sub('PAST_DUE'));
    render(<FacturacionPage />);
    expect(await screen.findByText('Pago pendiente')).toBeInTheDocument();
  });

  it('un estado desconocido se muestra tal cual y no como "Cancelada"', async () => {
    setup(sub('PAUSED'));
    render(<FacturacionPage />);
    expect(await screen.findByText('PAUSED')).toBeInTheDocument();
    expect(screen.queryByText('Cancelada')).toBeNull();
  });

  it('con suscripción cancelada vuelve el checkout ("Elegir plan") y no hay portal', async () => {
    setup(sub('CANCELLED'));
    render(<FacturacionPage />);
    expect(await screen.findByText('Cancelada')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Gestionar suscripción/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: /Elegir plan/ }).length).toBeGreaterThan(0);
  });

  it('sin suscripción muestra "Elegir plan" y no el portal', async () => {
    setup(null);
    render(<FacturacionPage />);
    expect((await screen.findAllByRole('button', { name: /Elegir plan/ })).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Gestionar suscripción/ })).toBeNull();
  });
});
