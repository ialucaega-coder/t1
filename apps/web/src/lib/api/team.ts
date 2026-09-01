import { httpClient } from './http-client';

export function getMembers() {
  return httpClient.get<any[]>('/team/members');
}

export function inviteMember(data: { email: string; role: string }) {
  return httpClient.post<any>('/team/invite', data);
}

export function updateMember(id: string, data: any) {
  return httpClient.patch<any>(`/team/members/${id}`, data);
}

export function removeMember(id: string) {
  return httpClient.delete<void>(`/team/members/${id}`);
}
