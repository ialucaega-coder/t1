import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { role: 'ADMIN' } }) }));
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/api/index', () => ({
  brandApi: {
    getBrandVoice: vi.fn().mockResolvedValue({ tono: '', publicoObjetivo: '', infoNegocio: '', reglas: '', emojis: true }),
    updateBrandVoice: vi.fn(),
  },
  faqApi: { getFaq: vi.fn().mockResolvedValue({ items: [] }), saveFaq: vi.fn() },
}));

import VozDeMarcaPage from '@/app/(dashboard)/voz-de-marca/page';

describe('VozDeMarcaPage: maxLength según los topes del server (validators/brand.ts)', () => {
  it('tono 500, público 500, información 5000 y reglas 2000', async () => {
    render(<VozDeMarcaPage />);
    const tono = await screen.findByPlaceholderText(/cercano y profesional/);
    expect(tono).toHaveAttribute('maxlength', '500');
    expect(screen.getByPlaceholderText(/dueños de PyMEs/)).toHaveAttribute('maxlength', '500');
    expect(screen.getByPlaceholderText(/Escribí en texto libre/)).toHaveAttribute('maxlength', '5000');
    expect(screen.getByPlaceholderText(/nunca prometer descuentos/)).toHaveAttribute('maxlength', '2000');
  });

  it('muestra el contador de la información del negocio', async () => {
    render(<VozDeMarcaPage />);
    expect(await screen.findByText(/\(0\/5000\)/)).toBeInTheDocument();
  });
});
