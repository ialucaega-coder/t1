/**
 * Pruebas de `PaymentModal` (`src/components/pos/PaymentModal.tsx`).
 * Componente de cobro: se prueban el resumen y total, el cálculo de vuelto en
 * efectivo, el bloqueo del botón ante efectivo insuficiente, y el cobro —
 * incluyendo el header Idempotency-Key, el payload, la pantalla de éxito y la
 * degradación a recibo LOCAL cuando la API falla.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const post = vi.fn();
vi.mock('@/lib/api/http-client', () => ({ httpClient: { post: (...a: unknown[]) => post(...a) } }));

import { PaymentModal } from '@/components/pos/PaymentModal';

beforeAll(() => {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { ...globalThis.crypto, randomUUID: () => `id-${Math.random().toString(36).slice(2)}` },
    });
  }
});

const baseProps = () => ({
  total: 1500,
  items: [{ name: 'Corte', price: 1000, qty: 1 }, { name: 'Barba', price: 500, qty: 1 }],
  clientName: 'Ana',
  discount: 10,
  onClose: vi.fn(),
  onComplete: vi.fn(),
});

beforeEach(() => {
  vi.clearAllMocks();
  post.mockResolvedValue({ id: 'txn_abcd1234' });
});

describe('components/pos/PaymentModal', () => {
  it('muestra el resumen, el descuento y el total', () => {
    render(<PaymentModal {...baseProps()} />);
    expect(screen.getByText('1x Corte')).toBeInTheDocument();
    expect(screen.getByText('Descuento 10%')).toBeInTheDocument();
    // Total aparece en el botón de cobro.
    expect(screen.getByRole('button', { name: /Cobrar \$1\.500/ })).toBeInTheDocument();
  });

  it('calcula el vuelto cuando el efectivo cubre el total', () => {
    render(<PaymentModal {...baseProps()} />);
    fireEvent.change(screen.getByPlaceholderText('1500'), { target: { value: '2000' } });
    expect(screen.getByText('Vuelto: $500')).toBeInTheDocument();
  });

  it('deshabilita el botón de cobro si el efectivo es insuficiente', () => {
    render(<PaymentModal {...baseProps()} />);
    fireEvent.change(screen.getByPlaceholderText('1500'), { target: { value: '1000' } });
    expect(screen.getByRole('button', { name: /Cobrar/ })).toBeDisabled();
  });

  it('cobra con Idempotency-Key y payload correcto, y muestra la pantalla de éxito', async () => {
    const props = baseProps();
    render(<PaymentModal {...props} />);
    fireEvent.change(screen.getByPlaceholderText('1500'), { target: { value: '2000' } });
    fireEvent.click(screen.getByRole('button', { name: /Cobrar/ }));

    await waitFor(() => expect(screen.getByText('Venta completada')).toBeInTheDocument());

    const [path, body, headers] = post.mock.calls[0];
    expect(path).toBe('/transactions');
    expect(body).toMatchObject({
      amount: 1500,
      type: 'SALE',
      paymentMethod: 'CASH',
      notes: 'Cliente: Ana',
      reference: 'Descuento 10%',
    });
    expect(headers['Idempotency-Key']).toEqual(expect.any(String));
    expect(headers['Idempotency-Key'].length).toBeGreaterThan(0);

    // Recibo = últimos 8 del id en mayúscula; y el vuelto en la pantalla de éxito.
    expect(screen.getByText('Recibo #ABCD1234')).toBeInTheDocument();
    expect(screen.getByText('$500')).toBeInTheDocument();
  });

  it('degrada a recibo LOCAL cuando la API falla (no rompe el cobro)', async () => {
    post.mockRejectedValue(new Error('network'));
    render(<PaymentModal {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /Cobrar/ }));

    await waitFor(() => expect(screen.getByText('Venta completada')).toBeInTheDocument());
    expect(screen.getByText('Recibo #LOCAL')).toBeInTheDocument();
  });
});
