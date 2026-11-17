import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImageUrlField, isHttpsImageUrl } from '@/components/products/ImageUrlField';

function Harness({ initial = '' }: { initial?: string }) {
  const [v, setV] = useState(initial);
  return <ImageUrlField value={v} onChange={setV} />;
}

describe('isHttpsImageUrl', () => {
  it('solo acepta https sin credenciales', () => {
    expect(isHttpsImageUrl('https://cdn.example.com/a.png')).toBe(true);
    for (const bad of ['http://x.com/a.png', 'javascript:alert(1)', 'data:image/png;base64,AA', 'https://u:p@x.com/a.png', 'hola']) {
      expect(isHttpsImageUrl(bad), bad).toBe(false);
    }
  });
});

describe('ImageUrlField', () => {
  it('muestra vista previa con una URL https válida', () => {
    render(<Harness initial="https://cdn.example.com/a.png" />);
    expect(screen.getByAltText('Vista previa')).toHaveAttribute('src', 'https://cdn.example.com/a.png');
  });

  it('avisa y no renderiza <img> con una URL javascript:', () => {
    render(<Harness initial="javascript:alert(1)" />);
    expect(screen.queryByAltText('Vista previa')).toBeNull();
    expect(screen.getByText(/empiece con https/)).toBeInTheDocument();
  });

  it('muestra un aviso si la imagen no carga y reintenta al cambiar la URL', () => {
    render(<Harness initial="https://cdn.example.com/rota.png" />);
    fireEvent.error(screen.getByAltText('Vista previa'));
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar la imagen');
    expect(screen.queryByAltText('Vista previa')).toBeNull();

    fireEvent.change(screen.getByPlaceholderText('https://ejemplo.com/foto.jpg'), {
      target: { value: 'https://cdn.example.com/ok.png' },
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByAltText('Vista previa')).toHaveAttribute('src', 'https://cdn.example.com/ok.png');
  });

  it('no muestra nada de error con el campo vacío', () => {
    const onChange = vi.fn();
    render(<ImageUrlField value="" onChange={onChange} />);
    expect(screen.queryByAltText('Vista previa')).toBeNull();
    expect(screen.queryByText(/empiece con https/)).toBeNull();
  });
});
