/**
 * Pruebas de componente para `StatusBadge` (`src/components/ui/StatusBadge.tsx`).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge, type StatusBadgeVariant } from '@/components/ui/StatusBadge';

describe('components/ui/StatusBadge', () => {
  it('renderiza el contenido hijo', () => {
    render(<StatusBadge variant="active">Activo</StatusBadge>);

    expect(screen.getByText('Activo')).toBeInTheDocument();
  });

  const variants: StatusBadgeVariant[] = [
    'active',
    'inactive',
    'premium',
    'new',
    'warning',
    'error',
    'info',
  ];

  it.each(variants)('aplica una clase para la variante "%s"', (variant) => {
    render(<StatusBadge variant={variant}>Etiqueta</StatusBadge>);

    const badge = screen.getByText('Etiqueta');
    expect(badge.className.length).toBeGreaterThan(0);
  });

  it('combina className adicional con las clases de la variante', () => {
    render(
      <StatusBadge variant="info" className="mi-clase-extra">
        Info
      </StatusBadge>
    );

    const badge = screen.getByText('Info');
    expect(badge.className).toContain('mi-clase-extra');
  });

  it('usa clases distintas para variantes distintas', () => {
    const { container: c1 } = render(<StatusBadge variant="error">Error</StatusBadge>);
    const { container: c2 } = render(<StatusBadge variant="warning">Warning</StatusBadge>);

    expect(c1.firstChild).not.toEqual(c2.firstChild);
    expect((c1.firstChild as HTMLElement).className).not.toBe(
      (c2.firstChild as HTMLElement).className
    );
  });
});
