/**
 * SpendCapCard: muestra gasto/tope con barra por umbral, valida el monto,
 * guarda con toast real del server y es de solo lectura para quien no es ADMIN.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const toastMock = vi.fn();
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ toast: toastMock }) }));

let role = 'ADMIN';
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { role } }) }));

const getSpendCap = vi.fn();
const setSpendCap = vi.fn();
vi.mock('@/lib/api/ai', () => ({
  getSpendCap: (...a: unknown[]) => getSpendCap(...a),
  setSpendCap: (...a: unknown[]) => setSpendCap(...a),
}));

import { SpendCapCard, parseCapInput } from '@/components/ai/SpendCapCard';

const status = (over: Record<string, unknown> = {}) => ({
  capUsd: 20,
  spentUsd: 5,
  ratio: 0.25,
  level: 'ok',
  month: '2026-11',
  ...over,
});

beforeEach(() => {
  role = 'ADMIN';
  getSpendCap.mockReset();
  setSpendCap.mockReset();
  toastMock.mockReset();
});

describe('parseCapInput', () => {
  it.each([
    ['25', 25],
    ['25.5', 25.5],
    ['25,50', 25.5],
    ['  10  ', 10],
  ])('acepta %s', (raw, value) => {
    expect(parseCapInput(raw)).toEqual({ value });
  });

  it.each(['', 'abc', '-5', '0', '0.00', '1.234', '1e3', '100001'])('rechaza %j', (raw) => {
    expect(parseCapInput(raw)).toHaveProperty('error');
  });
});

describe('SpendCapCard', () => {
  it('muestra gasto, tope y la barra con aria-valuenow', async () => {
    getSpendCap.mockResolvedValue(status());
    render(<SpendCapCard />);

    const bar = await screen.findByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '25');
    expect(screen.getByText(/Dentro del tope/)).toBeInTheDocument();
    expect(screen.getByText(/precios son aproximados/i)).toBeInTheDocument();
    expect(screen.getByText(/deriva la conversación a una persona/)).toBeInTheDocument();
    expect(screen.getByText(/Mr Go/)).toBeInTheDocument();
  });

  it('al 80 % avisa con texto (no solo color) y al 100 % indica tope alcanzado', async () => {
    getSpendCap.mockResolvedValue(status({ spentUsd: 17, ratio: 0.85, level: 'warn' }));
    const { unmount } = render(<SpendCapCard />);
    expect(await screen.findByText(/Cerca del tope/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '85');
    unmount();

    getSpendCap.mockResolvedValue(status({ spentUsd: 25, ratio: 1.25, level: 'blocked' }));
    render(<SpendCapCard />);
    expect(await screen.findByText(/Tope alcanzado/)).toBeInTheDocument();
    // La barra no pasa de 100.
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  it('sin tope (ratio null) muestra el gasto real aproximado, sin barra ni porcentaje', async () => {
    getSpendCap.mockResolvedValue(status({ capUsd: null, spentUsd: 7.5, ratio: null }));
    render(<SpendCapCard />);

    expect(await screen.findByText(/Sin tope: el bot no se corta por gasto/)).toBeInTheDocument();
    expect(screen.getByText('US$ 7,50')).toBeInTheDocument();
    expect(screen.getByText(/\(aproximado\)/)).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText(/Dentro del tope|Cerca del tope|Tope alcanzado/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Quitar tope' })).not.toBeInTheDocument();
  });

  it('valida el monto antes de llamar al server', async () => {
    getSpendCap.mockResolvedValue(status());
    render(<SpendCapCard />);

    fireEvent.change(await screen.findByLabelText(/Cambiar tope mensual/), { target: { value: '12.345' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar tope/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/hasta 2 decimales/);
    expect(setSpendCap).not.toHaveBeenCalled();
  });

  it('guarda el tope y avisa con toast de éxito', async () => {
    getSpendCap.mockResolvedValue(status({ capUsd: null, spentUsd: 3, ratio: null }));
    setSpendCap.mockResolvedValue(status({ capUsd: 30, ratio: 0.1 }));
    render(<SpendCapCard />);

    fireEvent.change(await screen.findByLabelText(/Fijar tope mensual/), { target: { value: '30,00' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar tope/ }));

    await waitFor(() => expect(setSpendCap).toHaveBeenCalledWith(30));
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' })),
    );
    // Con el tope ya fijado aparece la barra.
    expect(await screen.findByRole('progressbar')).toBeInTheDocument();
  });

  it('muestra el error real del server en el toast', async () => {
    getSpendCap.mockResolvedValue(status());
    setSpendCap.mockRejectedValue(new Error('Insufficient permissions'));
    render(<SpendCapCard />);

    fireEvent.change(await screen.findByLabelText(/Cambiar tope mensual/), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar tope/ }));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({ type: 'error', message: 'Insufficient permissions' }),
    );
  });

  it('Quitar tope manda capUsd null', async () => {
    getSpendCap.mockResolvedValue(status());
    setSpendCap.mockResolvedValue(status({ capUsd: null, spentUsd: 5, ratio: null }));
    render(<SpendCapCard />);

    fireEvent.click(await screen.findByRole('button', { name: 'Quitar tope' }));

    await waitFor(() => expect(setSpendCap).toHaveBeenCalledWith(null));
    expect(await screen.findByText(/Sin tope: el bot/)).toBeInTheDocument();
  });

  it('para quien no es ADMIN es solo lectura', async () => {
    role = 'STAFF';
    getSpendCap.mockResolvedValue(status());
    render(<SpendCapCard />);

    await screen.findByRole('progressbar');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Guardar tope/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Solo un administrador puede cambiar el tope/)).toBeInTheDocument();
  });

  it('si falla la carga permite reintentar', async () => {
    getSpendCap.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(status());
    render(<SpendCapCard />);

    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('progressbar')).toBeInTheDocument();
  });
});
