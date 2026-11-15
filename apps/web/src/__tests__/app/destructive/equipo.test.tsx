/**
 * /equipo: flujo de invitación honesto. El alta manda un mail con link (el backend lo
 * confirma con `emailSent`); si no salió, la pantalla lo dice. Los pendientes se
 * reenvían / revocan con confirmación.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const toastMock = vi.fn();
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock('@/stores/page-counter', () => ({ usePageCounter: () => {}, fmtCounter: () => '' }));

const refetch = vi.fn();
const removeMember = vi.fn().mockResolvedValue(undefined);
let members: unknown[] = [];
vi.mock('@/hooks/use-team', () => ({
  useTeam: () => ({
    members,
    isLoading: false,
    error: null,
    refetch,
    updateMember: vi.fn(),
    removeMember,
  }),
}));
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    isLoading: false,
    planLabel: 'Pro',
    planCapabilities: [],
    catalog: [],
    isInPlan: () => true,
    capabilitiesFor: () => [],
    effectiveFor: () => [],
    hasOverride: () => false,
    save: vi.fn(),
    reset: vi.fn(),
  }),
}));

const inviteMember = vi.fn();
const resendInvite = vi.fn();
vi.mock('@/lib/api/index', () => ({
  teamApi: {
    inviteMember: (...args: unknown[]) => inviteMember(...args),
    resendInvite: (...args: unknown[]) => resendInvite(...args),
  },
}));

import EquipoPage from '@/app/(dashboard)/equipo/page';

const FUTURE = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString();
const PAST = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

const pendingMember = (over: Record<string, unknown> = {}) => ({
  id: 'm1',
  name: 'nueva',
  email: 'nueva@example.com',
  role: 'Profesional',
  status: 'pending',
  joinedAt: new Date().toISOString(),
  inviteExpiresAt: FUTURE,
  ...over,
});

function openInviteForm() {
  fireEvent.click(screen.getAllByRole('button', { name: /Invitar miembro/ })[0]);
  fireEvent.change(screen.getByPlaceholderText('correo@ejemplo.com'), { target: { value: 'a@b.com' } });
}

beforeEach(() => {
  vi.clearAllMocks();
  members = [];
  inviteMember.mockResolvedValue({ id: 'm9', email: 'a@b.com', emailSent: true, inviteExpiresAt: FUTURE });
  resendInvite.mockResolvedValue({ id: 'm1', emailSent: true, inviteExpiresAt: FUTURE });
  removeMember.mockResolvedValue(undefined);
});

describe('equipo: invitaciones', () => {
  it('al invitar, el mail salió: avisa "Invitación enviada a <email>"', async () => {
    render(<EquipoPage />);
    openInviteForm();
    fireEvent.click(screen.getByRole('button', { name: /Enviar invitación/ }));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({ type: 'success', message: 'Invitación enviada a a@b.com' }),
    );
    expect(inviteMember).toHaveBeenCalledWith({ email: 'a@b.com', role: 'PROFESSIONAL' });
    expect(refetch).toHaveBeenCalled();
  });

  it('si el mail NO salió, no dice "enviada": avisa que hay que reenviar', async () => {
    inviteMember.mockResolvedValue({ id: 'm9', email: 'a@b.com', emailSent: false, inviteExpiresAt: FUTURE });
    render(<EquipoPage />);
    openInviteForm();
    fireEvent.click(screen.getByRole('button', { name: /Enviar invitación/ }));

    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    const arg = toastMock.mock.calls[0][0];
    expect(arg.type).toBe('error');
    expect(arg.message).toMatch(/no pudimos enviar el mail/);
    expect(arg.message).not.toMatch(/Invitación enviada/);
  });

  it('un error del backend (ej. email ya en el equipo) se muestra tal cual', async () => {
    inviteMember.mockRejectedValue(new Error('Ese email ya es parte del equipo.'));
    render(<EquipoPage />);
    openInviteForm();
    fireEvent.click(screen.getByRole('button', { name: /Enviar invitación/ }));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({ type: 'error', message: 'Ese email ya es parte del equipo.' }),
    );
  });

  it('un miembro pendiente muestra estado, a quién se invitó y cuándo vence', () => {
    members = [pendingMember()];
    const { container } = render(<EquipoPage />);
    expect(container.textContent).toContain('PENDIENTE');
    expect(container.textContent).toMatch(/Invitación enviada a nueva@example\.com · vence el/);
  });

  it('una invitación vencida lo dice y pide reenviar', () => {
    members = [pendingMember({ inviteExpiresAt: PAST })];
    const { container } = render(<EquipoPage />);
    expect(container.textContent).toMatch(/venció/);
  });

  it('un miembro activo muestra ACTIVO y no ofrece Reenviar', () => {
    members = [pendingMember({ status: 'active', inviteExpiresAt: null })];
    const { container } = render(<EquipoPage />);
    expect(container.textContent).toContain('ACTIVO');
    expect(screen.queryByRole('button', { name: /Reenviar/ })).toBeNull();
  });

  it('Reenviar pide confirmación antes de llamar al backend', () => {
    members = [pendingMember()];
    render(<EquipoPage />);
    fireEvent.click(screen.getByRole('button', { name: /Reenviar/ }));

    expect(resendInvite).not.toHaveBeenCalled();
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toMatch(/El link anterior deja de funcionar/);
  });

  it('confirmar el reenvío llama a resendInvite y avisa', async () => {
    members = [pendingMember()];
    render(<EquipoPage />);
    fireEvent.click(screen.getByRole('button', { name: /Reenviar/ }));
    const dialog = screen.getByRole('alertdialog');
    const confirm = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Reenviar')!;
    fireEvent.click(confirm);

    await waitFor(() => expect(resendInvite).toHaveBeenCalledWith('m1'));
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({
        type: 'success',
        message: 'Invitación reenviada a nueva@example.com. El link anterior ya no sirve.',
      }),
    );
  });

  it('Revocar una invitación pide confirmación y borra al miembro pendiente', async () => {
    members = [pendingMember()];
    render(<EquipoPage />);
    fireEvent.click(screen.getByTitle('Acciones'));
    fireEvent.click(screen.getByRole('button', { name: /Revocar invitación/ }));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toMatch(/deja de funcionar/);
    expect(removeMember).not.toHaveBeenCalled();
    const confirm = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Revocar')!;
    fireEvent.click(confirm);

    await waitFor(() => expect(removeMember).toHaveBeenCalledWith('m1'));
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({ type: 'success', message: 'Invitación revocada' }),
    );
  });
});
