/**
 * Pruebas de componente para `ErrorAlert` (`src/components/common/ErrorAlert.tsx`).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorAlert } from '@/components/common/ErrorAlert';

describe('components/common/ErrorAlert', () => {
  it('muestra el mensaje de error', () => {
    render(<ErrorAlert message="Algo salio mal" />);

    expect(screen.getByText('Algo salio mal')).toBeInTheDocument();
  });

  it('expone el rol de alerta para accesibilidad', () => {
    render(<ErrorAlert message="Error" />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('no muestra el boton de reintentar cuando no se pasa onRetry', () => {
    render(<ErrorAlert message="Error" />);

    expect(screen.queryByText('Reintentar')).not.toBeInTheDocument();
  });

  it('muestra el boton de reintentar cuando se pasa onRetry', () => {
    render(<ErrorAlert message="Error" onRetry={vi.fn()} />);

    expect(screen.getByText('Reintentar')).toBeInTheDocument();
  });

  it('invoca onRetry al hacer click en reintentar', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ErrorAlert message="Error" onRetry={onRetry} />);

    await user.click(screen.getByText('Reintentar'));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('aplica className adicional al contenedor', () => {
    render(<ErrorAlert message="Error" className="mi-clase" />);

    expect(screen.getByRole('alert').className).toContain('mi-clase');
  });
});
