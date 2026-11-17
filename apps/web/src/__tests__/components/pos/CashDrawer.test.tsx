/**
 * Pruebas de `CashDrawer` (`src/components/pos/CashDrawer.tsx`).
 *
 * Es un componente que maneja DINERO (arqueo de caja), así que se prueba la
 * corrección aritmética a través de la UI: saldo esperado tras apertura,
 * ingresos y retiros; y el arqueo (contado vs esperado y su diferencia).
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/api/http-client', () => ({
  httpClient: { get: vi.fn().mockResolvedValue({ data: [] }) },
}));

import { CashDrawer } from '@/components/pos/CashDrawer';
import { httpClient } from '@/lib/api/http-client';

beforeAll(() => {
  // jsdom puede no exponer crypto.randomUUID; garantizamos su presencia.
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { ...globalThis.crypto, randomUUID: () => `id-${Math.random().toString(36).slice(2)}` },
    });
  }
});

beforeEach(() => {
  vi.clearAllMocks();
});

/** Lee el valor del card "Saldo esperado" (el valor precede a la etiqueta). */
function saldoEsperado(): string {
  return screen.getByText('Saldo esperado').previousElementSibling?.textContent ?? '';
}

/** Lee el valor que sigue a una etiqueta dada (cards Ventas/Retiros/Ingresos). */
function valorTrasEtiqueta(label: string): string {
  return screen.getByText(label).nextElementSibling?.textContent ?? '';
}

async function abrirCaja(monto: string) {
  fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: monto } });
  fireEvent.click(screen.getByRole('button', { name: /Abrir/ }));
  await screen.findByText('CAJA ABIERTA');
}

describe('components/pos/CashDrawer', () => {
  it('arranca cerrada con saldo esperado en $0', async () => {
    render(<CashDrawer />);
    await waitFor(() => expect(screen.getByText('CAJA CERRADA')).toBeInTheDocument());
    expect(saldoEsperado()).toContain('0');
  });

  it('suma la apertura, los ingresos y resta los retiros al saldo esperado', async () => {
    render(<CashDrawer />);
    await screen.findByText('CAJA CERRADA');

    await abrirCaja('1000');
    expect(saldoEsperado()).toBe('$1.000');

    // Ingreso de $500 → 1500
    fireEvent.click(screen.getByRole('button', { name: /Ingreso/ }));
    fireEvent.change(screen.getByPlaceholderText('Monto'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(saldoEsperado()).toBe('$1.500'));
    expect(valorTrasEtiqueta('Ingresos extra')).toBe('$500');

    // Retiro de $200 → 1300
    fireEvent.click(screen.getByRole('button', { name: /Retiro/ }));
    fireEvent.change(screen.getByPlaceholderText('Monto'), { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(saldoEsperado()).toBe('$1.300'));
    expect(valorTrasEtiqueta('Retiros')).toBe('$200');
  });

  it('en el arqueo calcula contado, esperado y diferencia', async () => {
    const { container } = render(<CashDrawer />);
    await screen.findByText('CAJA CERRADA');
    await abrirCaja('1300');

    fireEvent.click(screen.getByRole('button', { name: /Cerrar y arquear/ }));
    await screen.findByText('Conteo de efectivo');

    // En el arqueo, los únicos number inputs son las 10 denominaciones, en el
    // orden de DENOMINATIONS: [0]=$1000, [1]=$500, [2]=$200, [3]=$100, ...
    const denoms = () => container.querySelectorAll('input[type="number"]');
    const setCount = (index: number, qty: string) =>
      fireEvent.change(denoms()[index], { target: { value: qty } });

    // Cuenta exacta: 1x$1000 + 1x$200 + 1x$100 = 1300 → diferencia 0.
    setCount(0, '1');
    setCount(2, '1');
    setCount(3, '1');

    const diferencia = () => screen.getByText('Diferencia').nextElementSibling?.textContent ?? '';
    await waitFor(() => expect(diferencia()).toContain('0'));
    expect(diferencia()).not.toContain('-');

    // Sobrante: sumo $100 más ($100 x2) → diferencia +$100.
    setCount(3, '2');
    await waitFor(() => expect(diferencia()).toBe('+$100'));
    expect(screen.getByText(/sobrante de efectivo/i)).toBeInTheDocument();
  });

  it('pide las ventas del día argentino (22:00 AR = 01:00Z del día siguiente) con from y to', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-17T01:00:00Z'));
    const get = httpClient.get as ReturnType<typeof vi.fn>;
    render(<CashDrawer />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    const url = get.mock.calls[0][0] as string;
    expect(url).toContain('from=2026-11-16&to=2026-11-16');
    expect(url).not.toContain('2026-11-17');
  });

  it('avisa que la caja se guarda solo en este dispositivo', async () => {
    render(<CashDrawer />);
    expect(await screen.findByText(/La caja se guarda solo en este dispositivo/)).toBeInTheDocument();
  });
});
