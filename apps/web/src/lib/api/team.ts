import { httpClient } from './http-client';
import type { TeamMember } from '@/constants/team';

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
