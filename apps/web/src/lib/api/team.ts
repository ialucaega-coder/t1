import { httpClient } from './http-client';
import type { TeamMember } from '@/constants/team';
import type { User, Business } from '@/types';
import type { Capability, TeamRoleEnum, PlanTier } from '@/constants/permissions';

export interface UpdateTeamMemberInput {
  role?: string;
  status?: string;
}

// El backend guarda el estado como enum (PENDING | ACTIVE | REVOKED); la UI usa
// 'pending' | 'active'. Cualquier otro valor (REVOKED) se muestra como pendiente.
type RawTeamMember = Omit<TeamMember, 'status'> & { status: string };

function normalizeStatus(status: string): TeamMember['status'] {
  return status === 'ACTIVE' || status === 'active' ? 'active' : 'pending';
}

export async function getMembers(): Promise<TeamMember[]> {
  const rows = await httpClient.get<RawTeamMember[]>('/team/members');
  return rows.map((m) => ({ ...m, status: normalizeStatus(m.status) }));
}

// Respuesta de invitar. `emailSent: false` = el miembro y la invitación quedaron
// creados pero el mail NO salió (proveedor sin configurar, etc.): hay que avisarlo.
export interface InviteResponse {
  id: string;
  email: string;
  emailSent: boolean;
  inviteExpiresAt: string;
}

export function inviteMember(data: { email: string; role: string }) {
  return httpClient.post<InviteResponse>('/team/invite', data);
}

// Reenvía la invitación: el link anterior deja de funcionar.
export function resendInvite(id: string) {
  return httpClient.post<{ id: string; emailSent: boolean; inviteExpiresAt: string }>(
    `/team/members/${id}/resend`,
    {},
  );
}

export function updateMember(id: string, data: UpdateTeamMemberInput) {
  return httpClient.patch<TeamMember>(`/team/members/${id}`, data);
}

export function removeMember(id: string) {
  return httpClient.delete<void>(`/team/members/${id}`);
}

// --- Permisos granulares ---

export interface PermissionsResponse {
  catalog: Capability[];
  roleDefaults: Record<TeamRoleEnum, string[]>;
  overrides: Record<string, string[]>;
  planTier: PlanTier;
  planLabel: string;
  planCapabilities: string[];
}

export interface MemberPermissionsResponse {
  memberId: string;
  role: TeamRoleEnum;
  permissions: string[];
}

export interface MyAccessResponse {
  planTier: PlanTier;
  planLabel: string;
  roleCapabilities: string[];
  planCapabilities: string[];
}

export function getPermissions() {
  return httpClient.get<PermissionsResponse>('/team/permissions');
}

export function getMyAccess() {
  return httpClient.get<MyAccessResponse>('/team/my-access');
}

export function saveMemberPermissions(memberId: string, permissions: string[]) {
  return httpClient.put<MemberPermissionsResponse>(`/team/permissions/${memberId}`, { permissions });
}

export function resetMemberPermissions(memberId: string) {
  return httpClient.delete<MemberPermissionsResponse>(`/team/permissions/${memberId}`);
}

// --- Aceptar invitación (pública: el invitado todavía no tiene sesión) ---

export interface AcceptInviteResponse {
  token: string;
  user: User;
  business: Business;
}

// Canjea el token del mail, crea la cuenta y deja la sesión iniciada (mismo
// mecanismo que el registro: guardamos el JWT en el cliente HTTP).
export async function acceptInvite(data: { token: string; name: string; password: string }) {
  const res = await httpClient.post<AcceptInviteResponse>('/auth/accept-invite', data);
  httpClient.setToken(res.token);
  return res;
}
