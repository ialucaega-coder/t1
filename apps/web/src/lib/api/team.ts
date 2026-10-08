import { httpClient } from './http-client';
import type { TeamMember } from '@/constants/team';
import type { Capability, TeamRoleEnum, PlanTier } from '@/constants/permissions';

export interface UpdateTeamMemberInput {
  role?: string;
  status?: string;
}

export function getMembers() {
  return httpClient.get<TeamMember[]>('/team/members');
}

export function inviteMember(data: { email: string; role: string }) {
  return httpClient.post<TeamMember>('/team/invite', data);
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
