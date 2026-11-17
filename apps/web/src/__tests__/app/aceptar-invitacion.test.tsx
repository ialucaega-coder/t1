/**
 * /aceptar-invitacion (pública): lee el token del fragmento y lo saca de la URL,
 * valida nombre + contraseña (misma política que el registro), canjea contra el
 * backend y maneja el token inválido/vencido sin exponer datos del negocio.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const acceptInvite = vi.fn();
vi.mock('@/lib/api/index', () => ({
  teamApi: { acceptInvite: (...args: unknown[]) => acceptInvite(...args) },
}));

import AceptarInvitacionPage from '@/app/(auth)/aceptar-invitacion/page';

const INVALID_MSG = 'La invitación no es válida o ya venció. Pedile a quien te invitó que te envíe una nueva.';
const GOOD = 'Clave1234';

function setHash(hash: string) {
  window.history.replaceState(null, '', `/aceptar-invitacion${hash}`);
}

function fill({ name = 'Ana Pérez', password = GOOD, confirm = GOOD } = {}) {
  fireEvent.change(screen.getByLabelText('Tu nombre'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Repetí la contraseña'), { target: { value: confirm } });
  fireEvent.click(screen.getByRole('button', { name: /Aceptar y entrar/ }));
}

beforeEach(() => {
  vi.clearAllMocks();
  acceptInvite.mockResolvedValue({ token: 't', user: {}, business: {} });
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('aceptar-invitacion', () => {
  it('sin token en el link muestra "Invitación no válida" y ningún formulario', async () => {
    setHash('');
    render(<AceptarInvitacionPage />);
    await screen.findByText('Invitación no válida');
    expect(screen.queryByLabelText('Contraseña')).toBeNull();
    expect(acceptInvite).not.toHaveBeenCalled();
  });

  it('lee el token del fragmento y lo saca de la barra de direcciones', async () => {
    setHash('#token=biz_1.SECRETO');
    render(<AceptarInvitacionPage />);
    await screen.findByRole('button', { name: /Aceptar y entrar/ });
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain('SECRETO');
  });

  it('no consulta nada al backend ni muestra datos del negocio antes de enviar', async () => {
    setHash('#token=biz_1.SECRETO');
    const { container } = render(<AceptarInvitacionPage />);
    await screen.findByRole('button', { name: /Aceptar y entrar/ });
    expect(acceptInvite).not.toHaveBeenCalled();
    expect(container.textContent).not.toMatch(/@/);
  });

  it('envía token, nombre y contraseña al backend', async () => {
    // Tras el canje la página navega a /dashboard; jsdom no implementa navegación y lo loguea.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    setHash('#token=biz_1.SECRETO');
    render(<AceptarInvitacionPage />);
    await screen.findByLabelText('Tu nombre');
    fill();

    await waitFor(() =>
      expect(acceptInvite).toHaveBeenCalledWith({ token: 'biz_1.SECRETO', name: 'Ana Pérez', password: GOOD }),
    );
  });

  it('valida en el cliente: contraseña floja o que no coincide NO llega al backend', async () => {
    setHash('#token=biz_1.SECRETO');
    render(<AceptarInvitacionPage />);
    await screen.findByLabelText('Tu nombre');

    fill({ password: 'abcdefgh', confirm: 'abcdefgh' });
    expect((await screen.findByRole('alert')).textContent).toMatch(/mayúscula/);

    fill({ password: GOOD, confirm: 'Otra12345' });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/no coinciden/));
    expect(acceptInvite).not.toHaveBeenCalled();
  });

  it('token inválido/vencido (error genérico del backend) pasa a la pantalla de invitación no válida', async () => {
    acceptInvite.mockRejectedValue(new Error(INVALID_MSG));
    setHash('#token=biz_1.SECRETO');
    render(<AceptarInvitacionPage />);
    await screen.findByLabelText('Tu nombre');
    fill();

    await screen.findByText('Invitación no válida');
    expect(screen.queryByLabelText('Contraseña')).toBeNull();
  });

  it('otros errores (ej. demasiados intentos) se muestran sin perder el formulario', async () => {
    acceptInvite.mockRejectedValue(new Error('Demasiados intentos. Probá de nuevo en unos minutos.'));
    setHash('#token=biz_1.SECRETO');
    render(<AceptarInvitacionPage />);
    await screen.findByLabelText('Tu nombre');
    fill();

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Demasiados intentos/));
    expect(screen.getByLabelText('Tu nombre')).toBeTruthy();
  });
});
