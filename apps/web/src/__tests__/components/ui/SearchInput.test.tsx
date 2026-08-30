/**
 * Pruebas de componente para `SearchInput` (`src/components/ui/SearchInput.tsx`).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchInput } from '@/components/ui/SearchInput';

describe('components/ui/SearchInput', () => {
  it('renderiza el placeholder por defecto', () => {
    render(<SearchInput value="" onChange={vi.fn()} />);

    expect(screen.getByPlaceholderText('Buscar...')).toBeInTheDocument();
  });

  it('permite personalizar el placeholder', () => {
    render(<SearchInput value="" onChange={vi.fn()} placeholder="Buscar clientes..." />);

    expect(screen.getByPlaceholderText('Buscar clientes...')).toBeInTheDocument();
  });

  it('muestra el valor recibido por props', () => {
    render(<SearchInput value="hola" onChange={vi.fn()} />);

    expect(screen.getByDisplayValue('hola')).toBeInTheDocument();
  });

  it('llama a onChange con el nuevo valor al escribir', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(<SearchInput value="" onChange={handleChange} />);

    const input = screen.getByPlaceholderText('Buscar...');
    await user.type(input, 'a');

    expect(handleChange).toHaveBeenCalledWith('a');
  });

  it('aplica className adicional al contenedor', () => {
    const { container } = render(
      <SearchInput value="" onChange={vi.fn()} className="mi-clase" />
    );

    expect((container.firstChild as HTMLElement).className).toContain('mi-clase');
  });
});
