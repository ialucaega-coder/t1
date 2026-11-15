/** /equipo: los textos no prometen mail ni link de 7 días (el backend solo crea el miembro). */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const toastMock = vi.fn();
vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock('@/stores/page-counter', () => ({ usePageCounter: () => {}, fmtCounter: () => '' }));

const inviteMember = vi.fn().mockResolvedValue(undefined);
vi.mock('@/hooks/use-team', () => ({
  useTeam: () => ({
    members: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    inviteMember,
    updateMember: vi.fn(),
    removeMember: vi.fn(),
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

import EquipoPage from '@/app/(dashboard)/equipo/page';

describe('equipo: textos honestos', () => {
  it('no menciona link de 7 días ni "invitación enviada"', () => {
    const { container } = render(<EquipoPage />);
    expect(container.textContent).not.toMatch(/7 días/);
    expect(container.textContent).not.toMatch(/link/i);
    expect(container.textContent).not.toMatch(/Invitación enviada/);
  });

  it('al agregar un miembro avisa "Miembro agregado al equipo"', async () => {
    render(<EquipoPage />);
    fireEvent.click(screen.getAllByRole('button', { name: /Agregar miembro/ })[0]);
    fireEvent.change(screen.getByPlaceholderText('correo@ejemplo.com'), { target: { value: 'a@b.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Agregar al equipo/ }));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({ type: 'success', message: 'Miembro agregado al equipo' }),
    );
  });
});
