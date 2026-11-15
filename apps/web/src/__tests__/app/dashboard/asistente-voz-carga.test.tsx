/** /asistente-voz: si falla la carga muestra error con "Reintentar", y avisa de cambios sin guardar. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ business: { name: 'Barbería Central' } }) }));

const getConfig = vi.fn();
const getStatus = vi.fn();
const saveConfig = vi.fn();
vi.mock('@/lib/api/voice', () => ({
  getConfig: (...a: unknown[]) => getConfig(...a),
  getStatus: (...a: unknown[]) => getStatus(...a),
  saveConfig: (...a: unknown[]) => saveConfig(...a),
}));

import AsistenteVozPage from '@/app/(dashboard)/asistente-voz/page';

const CFG = {
  enabled: true, assistantName: 'Sofía', language: 'es-MX', voice: 'Polly.Mia', rate: 1,
  greeting: 'Hola', closing: 'Chau', reprompt: 'Perdón', persona: 'Cálida',
};

beforeEach(() => {
  getConfig.mockReset();
  getStatus.mockReset().mockResolvedValue({ configured: true });
  saveConfig.mockReset();
});

describe('asistente-voz', () => {
  it('si getConfig falla muestra el error y "Reintentar" vuelve a pedirla', async () => {
    getConfig.mockRejectedValueOnce(new Error('Servidor caído')).mockResolvedValueOnce(CFG);
    render(<AsistenteVozPage />);

    expect(await screen.findByText('Servidor caído')).toBeTruthy();
    expect(screen.queryByText(/Cargando asistente de voz/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Reintentar/ }));
    expect(await screen.findByText('Asistente de Voz')).toBeTruthy();
    expect(getConfig).toHaveBeenCalledTimes(2);
  });

  it('tocar el interruptor Activo/Inactivo avisa que hay cambios sin guardar y guardar lo persiste', async () => {
    getConfig.mockResolvedValue(CFG);
    saveConfig.mockResolvedValue({ ...CFG, enabled: false });
    render(<AsistenteVozPage />);
    await screen.findByText('Asistente de Voz');
    expect(screen.queryByText(/cambios sin guardar/)).toBeNull();

    fireEvent.click(screen.getByText('Activo').closest('label')!.querySelector('button')!);
    expect(await screen.findByText(/cambios sin guardar/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Guardar ahora/ }));
    await waitFor(() => expect(saveConfig).toHaveBeenCalledWith(expect.objectContaining({ enabled: false })));
    await waitFor(() => expect(screen.queryByText(/cambios sin guardar/)).toBeNull());
  });
});
