/** /dashboard: eliminar un bot pide confirmación y pausar/activar informa los errores. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const toastMock = vi.fn();
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock('@/components/dashboard/OnboardingChecklist', () => ({ OnboardingChecklist: () => null }));
vi.mock('@/stores/page-counter', () => ({ usePageCounter: () => {}, fmtCounter: () => '' }));
vi.mock('@/hooks/use-socket', () => ({ useSocket: () => {}, useSocketEvent: () => {} }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ business: { id: 'biz' } }) }));
vi.mock('@/lib/api/index', () => ({
  statsApi: { getDashboard: vi.fn().mockResolvedValue(null) },
}));
vi.mock('@/hooks/use-stats', () => ({
  useStats: () => ({ overview: null, isLoading: false, error: null, refetch: vi.fn() }),
}));

const updateBot = vi.fn();
const deleteBot = vi.fn();
const bot = {
  id: 'bot1',
  name: 'Mi Bot',
  description: null,
  channel: 'WHATSAPP',
  status: 'ACTIVE',
  messageCount: 0,
  _count: { conversations: 0 },
};
vi.mock('@/hooks/use-bots', () => ({
  useBots: () => ({
    bots: [bot],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    createBot: vi.fn(),
    updateBot,
    deleteBot,
  }),
}));

import DashboardPage from '@/app/(dashboard)/dashboard/page';

beforeEach(() => {
  updateBot.mockReset();
  deleteBot.mockReset();
  toastMock.mockReset();
});

describe('dashboard: bots', () => {
  it('eliminar no borra hasta confirmar', async () => {
    deleteBot.mockResolvedValue(undefined);
    render(<DashboardPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar bot Mi Bot' }));
    expect(deleteBot).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(deleteBot).toHaveBeenCalledWith('bot1'));
  });

  it('si pausar falla muestra un toast de error (sin promesa rechazada)', async () => {
    updateBot.mockRejectedValue(new Error('No autorizado'));
    render(<DashboardPage />);

    fireEvent.click(screen.getByTitle('Pausar'));
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: 'No autorizado' })),
    );
  });
});
