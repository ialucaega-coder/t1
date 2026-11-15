/**
 * Cliente de equipo (`src/lib/api/team.ts`): normaliza el estado del backend
 * (PENDING/ACTIVE) al de la UI, y el canje de la invitación deja la sesión iniciada.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/api/http-client', () => ({
  httpClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), setToken: vi.fn() },
}));

import * as teamApi from '@/lib/api/team';
import { httpClient } from '@/lib/api/http-client';

const get = httpClient.get as unknown as ReturnType<typeof vi.fn>;
const post = httpClient.post as unknown as ReturnType<typeof vi.fn>;
const setToken = httpClient.setToken as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

describe('lib/api/team', () => {
  it('getMembers traduce PENDING/ACTIVE del backend a pending/active de la UI', async () => {
    get.mockResolvedValue([
      { id: 'a', status: 'PENDING', inviteExpiresAt: '2026-11-22T00:00:00.000Z' },
      { id: 'b', status: 'ACTIVE', inviteExpiresAt: null },
      { id: 'c', status: 'REVOKED' },
    ]);
    const members = await teamApi.getMembers();
    expect(members.map((m) => m.status)).toEqual(['pending', 'active', 'pending']);
    expect(members[0].inviteExpiresAt).toBe('2026-11-22T00:00:00.000Z');
  });

  it('inviteMember y resendInvite pegan a los endpoints correctos', async () => {
    post.mockResolvedValue({});
    await teamApi.inviteMember({ email: 'a@b.com', role: 'VIEWER' });
    await teamApi.resendInvite('m1');
    expect(post).toHaveBeenNthCalledWith(1, '/team/invite', { email: 'a@b.com', role: 'VIEWER' });
    expect(post).toHaveBeenNthCalledWith(2, '/team/members/m1/resend', {});
  });

  it('acceptInvite canjea el token y guarda la sesión', async () => {
    post.mockResolvedValue({ token: 'jwt-123', user: { id: 'u' }, business: { id: 'b' } });
    await teamApi.acceptInvite({ token: 'biz.sec', name: 'Ana', password: 'Clave1234' });
    expect(post).toHaveBeenCalledWith('/auth/accept-invite', { token: 'biz.sec', name: 'Ana', password: 'Clave1234' });
    expect(setToken).toHaveBeenCalledWith('jwt-123');
  });

  it('si el canje falla no deja ninguna sesión guardada', async () => {
    post.mockRejectedValue(new Error('La invitación no es válida'));
    await expect(teamApi.acceptInvite({ token: 'x', name: 'Ana', password: 'Clave1234' })).rejects.toThrow();
    expect(setToken).not.toHaveBeenCalled();
  });
});
