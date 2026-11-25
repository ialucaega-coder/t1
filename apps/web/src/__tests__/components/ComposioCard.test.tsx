/**
 * Pruebas de `ComposioCard` (`src/app/(dashboard)/conexiones/ComposioCard.tsx`).
 * Se mockea el cliente `@/lib/api/composio` para controlar el estado y las
 * llamadas de conexión/desconexión sin tocar la red, y `@/components/common/Toast`
 * para capturar los mensajes emitidos.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const getCmpStatus = vi.fn();
const connectCmp = vi.fn();
const disconnectCmp = vi.fn();
vi.mock('@/lib/api/composio', () => ({
  getCmpStatus: (...a: unknown[]) => getCmpStatus(...a),
  connectCmp: (...a: unknown[]) => connectCmp(...a),
  disconnectCmp: (...a: unknown[]) => disconnectCmp(...a),
}));

const toast = vi.fn();
vi.mock('@/components/common/Toast', () => ({
  useToast: () => ({ toast }),
}));

import { ComposioCard } from '@/app/(dashboard)/conexiones/ComposioCard';

beforeEach(() => {
  vi.clearAllMocks();
  getCmpStatus.mockResolvedValue({ connected: false, enabled: false });
  connectCmp.mockResolvedValue({ connected: true, enabled: true });
  disconnectCmp.mockResolvedValue({ connected: false, enabled: false });
});

describe('app/(dashboard)/conexiones/ComposioCard', () => {
  it('muestra el título y el subtítulo', async () => {
    render(<ComposioCard />);
    expect(screen.getByText('Composio')).toBeInTheDocument();
    expect(
      screen.getByText('Conectá 250+ apps y herramientas a tu bot vía Composio'),
    ).toBeInTheDocument();
    // Dejamos que el efecto de carga inicial se resuelva.
    await waitFor(() => expect(getCmpStatus).toHaveBeenCalled());
  });

  it('muestra el form de API key cuando está desconectado', async () => {
    render(<ComposioCard />);
    await waitFor(() =>
      expect(screen.getByText('API key de Composio')).toBeInTheDocument(),
    );
    expect(screen.getByText('Desconectado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Conectar' })).toBeInTheDocument();
  });

  it('conecta con la API key y pasa al estado conectado', async () => {
    render(<ComposioCard />);
    await waitFor(() =>
      expect(screen.getByPlaceholderText('comp_...')).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByPlaceholderText('comp_...'), {
      target: { value: 'comp_abc123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Conectar' }));

    await waitFor(() =>
      expect(screen.getByText('Cuenta de Composio conectada')).toBeInTheDocument(),
    );
    expect(connectCmp).toHaveBeenCalledWith('comp_abc123');
    expect(toast).toHaveBeenCalledWith({
      type: 'success',
      message: 'Composio conectado exitosamente',
    });
  });

  it('muestra un toast de error cuando la API key es inválida (400)', async () => {
    connectCmp.mockRejectedValue(new Error('API key inválida'));
    render(<ComposioCard />);
    await waitFor(() =>
      expect(screen.getByPlaceholderText('comp_...')).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByPlaceholderText('comp_...'), {
      target: { value: 'mala' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Conectar' }));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({ type: 'error', message: 'API key inválida' }),
    );
  });

  it('desconecta desde el estado conectado', async () => {
    getCmpStatus.mockResolvedValue({ connected: true, enabled: true });
    render(<ComposioCard />);
    await waitFor(() =>
      expect(screen.getByText('Cuenta de Composio conectada')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Desconectar' }));

    await waitFor(() => expect(disconnectCmp).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith({ type: 'success', message: 'Composio desconectado' });
  });
});
