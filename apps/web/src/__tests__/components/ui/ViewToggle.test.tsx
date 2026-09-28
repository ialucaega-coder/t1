/**
 * Pruebas de componente para `ViewToggle` (`src/components/ui/ViewToggle.tsx`).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ViewToggle, type ViewToggleOption } from '@/components/ui/ViewToggle';

const options: ViewToggleOption[] = [
  { value: 'grid', label: 'Grilla' },
  { value: 'list', label: 'Lista' },
];

describe('components/ui/ViewToggle', () => {
  it('renderiza una opcion por cada elemento', () => {
    render(<ViewToggle options={options} activeValue="grid" onChange={vi.fn()} />);

    expect(screen.getByText('Grilla')).toBeInTheDocument();
    expect(screen.getByText('Lista')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('invoca onChange con el value de la opcion clickeada', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ViewToggle options={options} activeValue="grid" onChange={onChange} />);

    await user.click(screen.getByText('Lista'));

    expect(onChange).toHaveBeenCalledWith('list');
  });

  it('marca la opcion activa con una clase distinta a las inactivas', () => {
    render(<ViewToggle options={options} activeValue="grid" onChange={vi.fn()} />);

    const activo = screen.getByText('Grilla');
    const inactivo = screen.getByText('Lista');

    expect(activo.className).not.toBe(inactivo.className);
    expect(activo.className).toContain('bg-brand-500');
  });

  it('aplica className adicional al contenedor', () => {
    const { container } = render(
      <ViewToggle options={options} activeValue="grid" onChange={vi.fn()} className="mi-clase" />
    );

    expect((container.firstChild as HTMLElement).className).toContain('mi-clase');
  });
});
