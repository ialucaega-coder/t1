/** /marketplace: la categoría coincide aunque el seed del server venga sin tildes, y los íconos PascalCase se resuelven. */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
const items = [
  { id: 'a', name: 'Menú digital QR', description: 'd', category: 'Gastronomia', rating: 4, reviews: 3, price: 'Gratis', installed: false, author: 'x', icon: 'QrCode' },
  { id: 'b', name: 'Agenda educativa', description: 'd', category: 'Educacion', rating: 4, reviews: 3, price: 'Gratis', installed: false, author: 'x', icon: 'GraduationCap' },
  { id: 'c', name: 'Cobro automático', description: 'd', category: 'Comercio', rating: 4, reviews: 3, price: 'Gratis', installed: false, author: 'x', icon: 'CreditCard' },
];
vi.mock('@/hooks/use-marketplace', () => ({
  useMarketplace: () => ({ items, isLoading: false, error: null, refetch: vi.fn(), installItem: vi.fn(), uninstallItem: vi.fn() }),
}));

import MarketplacePage from '@/app/(dashboard)/marketplace/page';

describe('marketplace — filtros', () => {
  it('"Gastronomía" (con tilde) muestra el item sembrado como "Gastronomia"', () => {
    render(<MarketplacePage />);
    fireEvent.click(screen.getByRole('button', { name: 'Gastronomía' }));

    expect(screen.getByText('Menú digital QR')).toBeTruthy();
    expect(screen.queryByText('Cobro automático')).toBeNull();
  });

  it('"Educación" muestra el item sembrado como "Educacion"', () => {
    render(<MarketplacePage />);
    fireEvent.click(screen.getByRole('button', { name: 'Educación' }));

    expect(screen.getByText('Agenda educativa')).toBeTruthy();
    expect(screen.queryByText('Menú digital QR')).toBeNull();
  });

  it('los íconos PascalCase del seed no caen todos al ShoppingBag por defecto', () => {
    const { container } = render(<MarketplacePage />);
    const icons = Array.from(container.querySelectorAll('.card-accent svg.lucide')).map((s) =>
      Array.from(s.classList).find((c) => c.startsWith('lucide-') && c !== 'lucide'),
    );
    // Los 3 items usan íconos distintos; si todos cayeran al default serían iguales.
    expect(new Set(icons).size).toBeGreaterThan(1);
    expect(icons.some((c) => c === 'lucide-shopping-bag')).toBe(false);
  });
});
