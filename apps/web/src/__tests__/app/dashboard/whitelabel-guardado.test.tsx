import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const toast = vi.hoisted(() => vi.fn());
const saveSettings = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({ logo: 'https://cdn.example.com/logo.png' }));

vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ toast }) }));
// `settings` debe ser estable entre renders (la página lo usa como dependencia de un effect).
vi.mock('@/hooks/use-whitelabel', () => {
  const cache = new Map<string, unknown>();
  return {
    useWhitelabel: () => {
      if (!cache.has(state.logo)) {
        cache.set(state.logo, {
          name: 'Mi Agencia',
          primaryColor: '#38BDF8',
          secondaryColor: '',
          accentColor: '#38BDF8',
          customDomain: '',
          logo: state.logo,
          theme: 'onyx',
          hiddenSections: [],
        });
      }
      return { settings: cache.get(state.logo), isLoading: false, error: null, saving: false, refetch: vi.fn(), saveSettings };
    },
  };
});

import WhitelabelPage from '@/app/(dashboard)/whitelabel/page';

describe('WhitelabelPage: guardado', () => {
  beforeEach(() => {
    toast.mockReset();
    saveSettings.mockReset();
    state.logo = 'https://cdn.example.com/logo.png';
  });

  it('avisa con un toast de éxito al guardar', async () => {
    saveSettings.mockResolvedValue(undefined);
    render(<WhitelabelPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ type: 'success', message: 'Cambios guardados correctamente' }));
  });

  it('muestra el error real del server (409 número duplicado) y no dice que guardó', async () => {
    saveSettings.mockRejectedValue(new Error('Ese número de teléfono/WhatsApp ya está en uso por otro negocio.'));
    render(<WhitelabelPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        type: 'error',
        message: 'Ese número de teléfono/WhatsApp ya está en uso por otro negocio.',
      }),
    );
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('con el logo vaciado manda logo: null (así se puede borrar)', async () => {
    saveSettings.mockResolvedValue(undefined);
    render(<WhitelabelPage />);
    fireEvent.change(screen.getByPlaceholderText('https://tucdn.com/logo.png'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(saveSettings).toHaveBeenCalled());
    expect(saveSettings.mock.calls[0][0].logo).toBeNull();
  });

  it('con logo cargado manda la URL recortada', async () => {
    saveSettings.mockResolvedValue(undefined);
    render(<WhitelabelPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(saveSettings).toHaveBeenCalled());
    expect(saveSettings.mock.calls[0][0].logo).toBe('https://cdn.example.com/logo.png');
  });
});
