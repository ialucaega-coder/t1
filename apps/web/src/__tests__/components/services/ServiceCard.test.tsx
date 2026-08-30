/**
 * Pruebas de componente para `ServiceCard` (`src/components/services/ServiceCard.tsx`).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ServiceCard } from '@/components/services/ServiceCard';
import type { Service } from '@/constants/services';

function makeService(overrides: Partial<Service> = {}): Service {
  return {
    id: 's-1',
    name: 'Corte caballero',
    duration: 30,
    price: 5000,
    category: 'Cortes',
    isActive: true,
    ...overrides,
  };
}

describe('components/services/ServiceCard', () => {
  it('renderiza el nombre del servicio', () => {
    render(<ServiceCard service={makeService()} />);

    expect(screen.getByText('Corte caballero')).toBeInTheDocument();
  });

  it('muestra la categoria del servicio', () => {
    render(<ServiceCard service={makeService({ category: 'Barberia' })} />);

    expect(screen.getByText('Barberia')).toBeInTheDocument();
  });

  it('muestra la duracion en minutos', () => {
    render(<ServiceCard service={makeService({ duration: 45 })} />);

    expect(screen.getByText(/45 min/)).toBeInTheDocument();
  });

  it('muestra el precio formateado', () => {
    render(<ServiceCard service={makeService({ price: 8000 })} />);

    // El precio se formatea con toLocaleString('es-AR')
    expect(screen.getByText(/8.000/)).toBeInTheDocument();
  });

  it('aplica clase de opacidad cuando el servicio esta inactivo', () => {
    const { container } = render(<ServiceCard service={makeService({ isActive: false })} />);

    expect((container.firstChild as HTMLElement).className).toContain('opacity-50');
  });

  it('no aplica clase de opacidad cuando el servicio esta activo', () => {
    const { container } = render(<ServiceCard service={makeService({ isActive: true })} />);

    expect((container.firstChild as HTMLElement).className).not.toContain('opacity-50');
  });

  it('muestra el boton de editar', () => {
    render(<ServiceCard service={makeService()} />);

    expect(screen.getByText('Editar')).toBeInTheDocument();
  });

  it('renderiza con datos completos sin errores', () => {
    const service = makeService({
      id: 's-99',
      name: 'Tratamiento capilar premium',
      duration: 120,
      price: 25000,
      category: 'Tratamientos',
      isActive: true,
    });

    const { container } = render(<ServiceCard service={service} />);

    expect(container.firstChild).toBeTruthy();
    expect(screen.getByText('Tratamiento capilar premium')).toBeInTheDocument();
    expect(screen.getByText('Tratamientos')).toBeInTheDocument();
  });
});
