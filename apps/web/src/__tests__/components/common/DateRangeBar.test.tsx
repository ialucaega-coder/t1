/** Selector de rango: presets, fechas personalizadas con validación y botón de exportar. */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DateRangeBar } from '@/components/common/DateRangeBar';

describe('DateRangeBar', () => {
  it('elegir un preset avisa con los días', () => {
    const onChange = vi.fn();
    render(<DateRangeBar value={{ kind: 'default' }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '30 días' }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'preset', days: 30 });
  });

  it('"Predeterminado" vuelve al comportamiento histórico', () => {
    const onChange = vi.fn();
    render(<DateRangeBar value={{ kind: 'preset', days: 7 }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Predeterminado' }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'default' });
  });

  it('personalizado: no aplica un rango invertido y muestra el error', () => {
    const onChange = vi.fn();
    render(<DateRangeBar value={{ kind: 'default' }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Personalizado' }));
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-31' } });
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/posterior/);
  });

  it('personalizado: aplica un rango válido', () => {
    const onChange = vi.fn();
    render(<DateRangeBar value={{ kind: 'default' }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Personalizado' }));
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-10-31' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    expect(onChange).toHaveBeenCalledWith({ kind: 'custom', from: '2026-10-01', to: '2026-10-31' });
  });

  it('el botón Exportar CSV solo aparece con onExport y respeta disabled', () => {
    const onExport = vi.fn();
    const { rerender } = render(<DateRangeBar value={{ kind: 'default' }} onChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Exportar CSV/ })).toBeNull();

    rerender(<DateRangeBar value={{ kind: 'default' }} onChange={vi.fn()} onExport={onExport} exportDisabled />);
    expect((screen.getByRole('button', { name: /Exportar CSV/ }) as HTMLButtonElement).disabled).toBe(true);

    rerender(<DateRangeBar value={{ kind: 'default' }} onChange={vi.fn()} onExport={onExport} />);
    fireEvent.click(screen.getByRole('button', { name: /Exportar CSV/ }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });
});
