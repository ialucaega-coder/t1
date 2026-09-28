/**
 * Pruebas de componente para `EmptyState` (`src/components/ui/EmptyState.tsx`).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Inbox } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';

describe('components/ui/EmptyState', () => {
  it('muestra el titulo', () => {
    render(<EmptyState icon={Inbox} title="Sin resultados" />);

    expect(screen.getByText('Sin resultados')).toBeInTheDocument();
  });

  it('muestra la descripcion cuando se pasa', () => {
    render(<EmptyState icon={Inbox} title="Vacio" description="Aun no hay datos" />);

    expect(screen.getByText('Aun no hay datos')).toBeInTheDocument();
  });

  it('no renderiza descripcion cuando no se pasa', () => {
    render(<EmptyState icon={Inbox} title="Vacio" />);

    expect(screen.queryByText('Aun no hay datos')).not.toBeInTheDocument();
  });

  it('no renderiza boton de accion sin actionLabel y onAction juntos', () => {
    render(<EmptyState icon={Inbox} title="Vacio" actionLabel="Crear" />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renderiza el boton de accion cuando hay actionLabel y onAction', () => {
    render(<EmptyState icon={Inbox} title="Vacio" actionLabel="Crear" onAction={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Crear' })).toBeInTheDocument();
  });

  it('invoca onAction al hacer click en el boton', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<EmptyState icon={Inbox} title="Vacio" actionLabel="Crear" onAction={onAction} />);

    await user.click(screen.getByRole('button', { name: 'Crear' }));

    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('aplica className adicional al contenedor', () => {
    const { container } = render(
      <EmptyState icon={Inbox} title="Vacio" className="mi-clase" />
    );

    expect((container.firstChild as HTMLElement).className).toContain('mi-clase');
  });
});
