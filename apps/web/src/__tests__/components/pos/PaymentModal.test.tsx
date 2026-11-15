/**
 * Pruebas de `PaymentModal` (`src/components/pos/PaymentModal.tsx`).
 * Componente de cobro: se prueban el resumen y total, el cálculo de vuelto en
 * efectivo, el bloqueo del botón ante efectivo insuficiente, y el cobro —
 * incluyendo el header Idempotency-Key, el payload, la pantalla de éxito y el
 * manejo de error (no se marca completada, se muestra el error y se reintenta).
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

  it('si la API falla NO marca la venta como completada: muestra el error del server y permite reintentar', async () => {
    post.mockRejectedValueOnce(new Error('Acceso denegado: se requiere rol ADMIN'));
    const props = baseProps();
    render(<PaymentModal {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /Cobrar/ }));

    // Error real del server visible, sin pantalla de éxito ni recibo LOCAL.
    expect(await screen.findByRole('alert')).toHaveTextContent('Acceso denegado: se requiere rol ADMIN');
    expect(screen.queryByText('Venta completada')).not.toBeInTheDocument();
    expect(screen.queryByText(/Recibo #/)).not.toBeInTheDocument();
    expect(props.onComplete).not.toHaveBeenCalled();

    // El formulario sigue ahí (carrito intacto) y el botón permite reintentar.
    const retry = screen.getByRole('button', { name: /Reintentar cobro \$1\.500/ });
    expect(retry).toBeEnabled();

    // Reintento exitoso: reusa la MISMA Idempotency-Key.
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByText('Venta completada')).toBeInTheDocument());
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1][2]['Idempotency-Key']).toBe(post.mock.calls[0][2]['Idempotency-Key']);
    expect(screen.getByText('Recibo #ABCD1234')).toBeInTheDocument();
  });
});
