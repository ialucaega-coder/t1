import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const counter = vi.hoisted(() => vi.fn());
const api = vi.hoisted(() => ({
  getStats: vi.fn(),
  getClients: vi.fn(),
  createClient: vi.fn(),
  updateClient: vi.fn(),
  deleteClient: vi.fn(),
}));

vi.mock('@/lib/api/index', () => ({ agencyApi: api }));
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/stores/page-counter', () => ({
  usePageCounter: (v: unknown) => counter(v),
  fmtCounter: (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`,
}));

import AgenciaPage from '@/app/(dashboard)/agencia/page';

function clientsOf(from: number, to: number) {
  return Array.from({ length: to - from + 1 }, (_, i) => ({
    id: `c${from + i}`,
    name: `Negocio ${from + i}`,
    plan: 'Free',
    status: 'active',
    bots: 1,
    revenue: '$0',
    lastActivity: 'hoy',
  }));
}

describe('AgenciaPage: paginación y búsqueda en el server', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getStats.mockResolvedValue({ totalBusinesses: 150, totalBots: 0, totalRevenue: '$0', activeClients: 0, referralLink: '', commission: '20%' });
  });

  it('pide la primera página con pageSize 100 y muestra el total real, no solo lo cargado', async () => {
    api.getClients.mockResolvedValue({ data: clientsOf(1, 100), total: 150 });
    render(<AgenciaPage />);
    expect(await screen.findByText('Mostrando 100 de 150 negocios')).toBeInTheDocument();
    expect(api.getClients).toHaveBeenCalledWith({ page: 1, pageSize: 100, search: undefined });
    // el contador del header usa el total del server
    expect(counter).toHaveBeenCalledWith('150 NEGOCIOS');
  });

  it('"Cargar más" trae la página siguiente, la suma a la lista y desaparece al llegar al total', async () => {
    api.getClients
      .mockResolvedValueOnce({ data: clientsOf(1, 100), total: 150 })
      .mockResolvedValueOnce({ data: clientsOf(101, 150), total: 150 });
    render(<AgenciaPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cargar más' }));
    expect(await screen.findByText('Mostrando 150 de 150 negocios')).toBeInTheDocument();
    expect(api.getClients).toHaveBeenLastCalledWith({ page: 2, pageSize: 100, search: undefined });
    expect(screen.getByText('Negocio 150')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cargar más' })).toBeNull();
  });

  it('sin más páginas no muestra "Cargar más"', async () => {
    api.getClients.mockResolvedValue({ data: clientsOf(1, 3), total: 3 });
    render(<AgenciaPage />);
    expect(await screen.findByText('Mostrando 3 de 3 negocios')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cargar más' })).toBeNull();
  });

  it('la búsqueda se manda al server (con debounce) en vez de filtrar solo lo cargado', async () => {
    api.getClients.mockResolvedValue({ data: clientsOf(1, 2), total: 2 });
    render(<AgenciaPage />);
    await screen.findByText('Mostrando 2 de 2 negocios');
    api.getClients.mockResolvedValue({ data: clientsOf(130, 130), total: 1 });

    fireEvent.change(screen.getByPlaceholderText('Buscar negocio...'), { target: { value: 'Negocio 130' } });
    await waitFor(() => expect(api.getClients).toHaveBeenLastCalledWith({ page: 1, pageSize: 100, search: 'Negocio 130' }), { timeout: 2000 });
    expect(await screen.findByText('Mostrando 1 de 1 negocio')).toBeInTheDocument();
    expect(screen.getByText('Negocio 130')).toBeInTheDocument();
    await act(async () => {});
  });
});
