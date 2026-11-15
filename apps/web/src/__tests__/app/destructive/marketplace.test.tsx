/** /marketplace: desinstalar pide confirmación; instalar/desinstalar informan errores. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const toastMock = vi.fn();
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ toast: toastMock }) }));

const installItem = vi.fn();
const uninstallItem = vi.fn();
const items = [
  { id: 'a', name: 'Bot Reservas', description: 'd', category: 'Comercio', rating: 4, reviews: 3, price: 'Gratis', installed: false, author: 'x', icon: 'calendar' },
  { id: 'b', name: 'Bot Ventas', description: 'd', category: 'Comercio', rating: 4, reviews: 3, price: 'Gratis', installed: true, author: 'x', icon: 'calendar' },
];
vi.mock('@/hooks/use-marketplace', () => ({
  useMarketplace: () => ({ items, isLoading: false, error: null, refetch: vi.fn(), installItem, uninstallItem }),
}));

import MarketplacePage from '@/app/(dashboard)/marketplace/page';

beforeEach(() => {
  installItem.mockReset();
  uninstallItem.mockReset();
  toastMock.mockReset();
});

describe('marketplace', () => {
  it('desinstalar no ejecuta hasta confirmar', async () => {
    uninstallItem.mockResolvedValue(undefined);
    render(<MarketplacePage />);
    fireEvent.click(screen.getByRole('button', { name: /Instalado/ }));

    expect(uninstallItem).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Desinstalar' }));
    await waitFor(() => expect(uninstallItem).toHaveBeenCalledWith('b'));
  });

  it('si instalar falla muestra un toast de error', async () => {
    installItem.mockRejectedValue(new Error('boom'));
    render(<MarketplacePage />);
    fireEvent.click(screen.getByRole('button', { name: /Instalar/ }));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })),
    );
  });

  it('si desinstalar falla muestra toast de error', async () => {
    uninstallItem.mockRejectedValue(new Error('boom'));
    render(<MarketplacePage />);
    fireEvent.click(screen.getByRole('button', { name: /Instalado/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Desinstalar' }));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })),
    );
  });
});
