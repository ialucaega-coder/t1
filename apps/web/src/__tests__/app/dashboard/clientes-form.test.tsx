import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  createClient: vi.fn(),
  setClientNote: vi.fn(),
  updateClient: vi.fn(),
  deleteClient: vi.fn(),
  exportCsv: vi.fn(),
}));
const toast = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/clients', () => api);
vi.mock('@/hooks/use-clients', () => ({
  useClients: () => ({
    clients: [], tagCatalog: [], total: 0, totalPages: 0, isLoading: false, error: null, refetch: vi.fn(),
  }),
  useClientDetail: () => ({ detail: null, isLoading: false, refetchDetail: vi.fn() }),
}));
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/stores/page-counter', () => ({ usePageCounter: () => {}, fmtCounter: () => '' }));
vi.mock('@/components/clients/ClientTags', () => ({
  TagChip: () => null, TagManager: () => null, ClientTagEditor: () => null,
}));
vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) => (isOpen ? <div>{children}</div> : null),
}));

import ClientesPage from '@/app/(dashboard)/clientes/page';

function fillAndSave(opts: { notes?: string } = {}) {
  fireEvent.click(screen.getByRole('button', { name: /Agregar cliente/i }));
  fireEvent.change(screen.getByPlaceholderText('Nombre completo'), { target: { value: 'Ana Pérez' } });
  fireEvent.change(screen.getByPlaceholderText('cliente@email.com'), { target: { value: 'ana@x.com' } });
  if (opts.notes) fireEvent.change(screen.getByPlaceholderText('Notas internas...'), { target: { value: opts.notes } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
}

describe('ClientesPage: alta de cliente', () => {
  beforeEach(() => {
    api.createClient.mockReset();
    api.setClientNote.mockReset();
  });

  it('guarda la nota escrita en el CRM del cliente recién creado', async () => {
    api.createClient.mockResolvedValue({ id: 'c1' });
    api.setClientNote.mockResolvedValue({ tags: [], note: 'VIP' });
    render(<ClientesPage />);
    fillAndSave({ notes: 'Cliente VIP' });
    await waitFor(() => expect(api.setClientNote).toHaveBeenCalledWith('c1', 'Cliente VIP'));
  });

  it('no llama a la API de notas si no hay nota', async () => {
    api.createClient.mockResolvedValue({ id: 'c1' });
    render(<ClientesPage />);
    fillAndSave();
    await waitFor(() => expect(api.createClient).toHaveBeenCalled());
    expect(api.setClientNote).not.toHaveBeenCalled();
  });

  it('muestra el mensaje real del server (409 email duplicado) y deja el modal abierto', async () => {
    api.createClient.mockRejectedValue(new Error('Ya existe un cliente con ese email'));
    render(<ClientesPage />);
    fillAndSave();
    expect(await screen.findByText('Ya existe un cliente con ese email')).toBeInTheDocument();
    expect(screen.queryByText('Error al crear cliente')).toBeNull();
    expect(screen.getByPlaceholderText('Nombre completo')).toBeInTheDocument();
  });

  it('muestra el aviso de límite de plan (403 PLAN_LIMIT_REACHED)', async () => {
    api.createClient.mockRejectedValue(
      new Error('Alcanzaste el límite de contactos de tu plan (50). Mejorá tu plan para agregar más.'),
    );
    render(<ClientesPage />);
    fillAndSave();
    expect(await screen.findByText(/Alcanzaste el límite de contactos de tu plan/)).toBeInTheDocument();
  });

  it('usa el mensaje genérico si el error no trae detalle', async () => {
    api.createClient.mockRejectedValue(new Error('HTTP 500'));
    render(<ClientesPage />);
    fillAndSave();
    expect(await screen.findByText('Error al crear cliente')).toBeInTheDocument();
  });
});
