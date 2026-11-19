import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/components/common/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/stores/page-counter', () => ({ usePageCounter: () => {}, fmtCounter: () => '' }));
vi.mock('@/hooks/use-team', () => ({
  useTeam: () => ({ members: [], isLoading: false, error: null, refetch: vi.fn(), updateMember: vi.fn(), removeMember: vi.fn() }),
}));
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({ capabilitiesFor: () => [], effectiveFor: () => [], save: vi.fn(), reset: vi.fn() }),
}));
vi.mock('@/lib/api/index', () => ({ teamApi: { inviteMember: vi.fn() } }));

import EquipoPage from '@/app/(dashboard)/equipo/page';

describe('EquipoPage: texto estático', () => {
  it('no promete funciones que no existen (recuperar contraseña, bitácora, asignar conversaciones)', () => {
    const { container } = render(<EquipoPage />);
    const text = container.textContent ?? '';
    expect(text).not.toContain('Recuperar contraseña');
    expect(text).not.toContain('Bitácora');
    expect(text).not.toContain('Asignar conversaciones');
    // lo único que queda es el dato real de seguridad
    expect(screen.getByText(/5 intentos fallidos de inicio de sesión/)).toBeInTheDocument();
  });
});
