/**
 * /clientes: baja con ConfirmDialog (danger), teléfono que se puede borrar y error
 * visible al exportar el CSV.
 */
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
const detail = {
  id: 'c1', name: 'Ana Pérez', email: 'ana@x.com', phone: '1155', note: '', tags: [], createdAt: '2026-01-01T00:00:00.000Z',
  _count: { bookingsAsClient: 0, orders: 0 }, bookingsAsClient: [], orders: [], notifications: [],
};
vi.mock('@/hooks/use-clients', () => ({
  useClients: () => ({
    clients: [{ id: 'c1', name: 'Ana Pérez', email: 'ana@x.com', _count: { bookingsAsClient: 0, orders: 0 }, bookingsAsClient: [] }],
    tagCatalog: [], total: 1, totalPages: 1, isLoading: false, error: null, refetch: vi.fn(),
  }),
  useClientDetail: (id: string | null) => ({ detail: id ? detail : null, isLoading: false, refetchDetail: vi.fn() }),
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

beforeEach(() => {
  vi.clearAllMocks();
  api.deleteClient.mockResolvedValue({ success: true });
  api.updateClient.mockResolvedValue({ id: 'c1' });
  api.setClientNote.mockResolvedValue({});
});

function selectClient() {
  render(<ClientesPage />);
  fireEvent.click(screen.getByText('Ana Pérez'));
}

describe('ClientesPage: eliminar con confirmación', () => {
  it('el botón de basura abre el diálogo y NO elimina hasta confirmar', async () => {
    selectClient();
    fireEvent.click(await screen.findByTitle('Eliminar cliente'));

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(api.deleteClient).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(api.deleteClient).toHaveBeenCalledWith('c1'));
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ type: 'success', message: 'Cliente eliminado correctamente' }));
  });

  it('cancelar el diálogo no elimina nada', async () => {
    selectClient();
    fireEvent.click(await screen.findByTitle('Eliminar cliente'));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(api.deleteClient).not.toHaveBeenCalled();
  });

  it('si el server rechaza (rol sin permiso) muestra un mensaje claro en español', async () => {
    api.deleteClient.mockRejectedValue(new Error('Insufficient permissions'));
    selectClient();
    fireEvent.click(await screen.findByTitle('Eliminar cliente'));
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({ type: 'error', message: 'Solo un administrador puede eliminar clientes' })
    );
  });
});

describe('ClientesPage: teléfono y exportación', () => {
  it('vaciar el teléfono al editar manda null (antes no se podía borrar)', async () => {
    selectClient();
    fireEvent.click(await screen.findByTitle('Editar cliente'));
    const phone = await screen.findByDisplayValue('1155');
    fireEvent.change(phone, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(api.updateClient).toHaveBeenCalledWith('c1', { name: 'Ana Pérez', phone: null }));
  });

  it('si la exportación falla muestra el mensaje en un toast (no se traga el error)', async () => {
    api.exportCsv.mockRejectedValue(new Error('No tenés permiso para exportar los clientes.'));
    render(<ClientesPage />);
    fireEvent.click(screen.getByRole('button', { name: /Exportar/ }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({ type: 'error', message: 'No tenés permiso para exportar los clientes.' })
    );
  });
});
