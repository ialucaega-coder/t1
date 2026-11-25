/**
 * /marketplace: ningún ítem tiene efecto real hoy (el server solo guarda una fila), así que la UI
 * es honesta ("Próximamente · Avisarme"); quitar el aviso pide confirmación y los errores se informan.
 */
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
    fireEvent.click(screen.getByRole('button', { name: /Te avisamos/ }));

    expect(uninstallItem).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Dejar de avisar' }));
    await waitFor(() => expect(uninstallItem).toHaveBeenCalledWith('b'));
  });

  it('si instalar falla muestra un toast de error', async () => {
    installItem.mockRejectedValue(new Error('boom'));
    render(<MarketplacePage />);
    fireEvent.click(screen.getByRole('button', { name: /Avisarme/ }));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })),
    );
  });

  it('si desinstalar falla muestra toast de error', async () => {
    uninstallItem.mockRejectedValue(new Error('boom'));
    render(<MarketplacePage />);
    fireEvent.click(screen.getByRole('button', { name: /Te avisamos/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Dejar de avisar' }));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })),
    );
  });

  it('NO ofrece "Instalar" ni dice "instalado correctamente": ningún ítem tiene efecto real', async () => {
    installItem.mockResolvedValue(undefined);
    render(<MarketplacePage />);

    expect(screen.queryByRole('button', { name: /^Instalar/ })).toBeNull();
    expect(screen.getByText(/todavía no están disponibles/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Próximamente · Avisarme/ }));
    await waitFor(() => expect(installItem).toHaveBeenCalledWith('a'));
    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    const msg = toastMock.mock.calls[0][0].message as string;
    expect(msg).toContain('te avisamos');
    expect(msg).toContain('Todavía no se activa nada');
    expect(msg).not.toContain('instalado correctamente');
  });

  it('el aviso anotado se muestra como "Te avisamos", no como "Instalado"', () => {
    render(<MarketplacePage />);
    expect(screen.getByRole('button', { name: /Te avisamos/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Instalado/ })).toBeNull();
  });
});
