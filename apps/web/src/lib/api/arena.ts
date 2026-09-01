import { httpClient } from './http-client';

export function getBuilders() {
  return httpClient.get<any[]>('/arena/builders');
}

export function createBuilder(data: any) {
  return httpClient.post<any>('/arena/builders', data);
}

export function updateBuilder(id: string, data: any) {
  return httpClient.patch<any>(`/arena/builders/${id}`, data);
}

export function deleteBuilder(id: string) {
  return httpClient.delete<void>(`/arena/builders/${id}`);
}

export function getIdeas() {
  return httpClient.get<any[]>('/arena/ideas');
}

export function createIdea(data: any) {
  return httpClient.post<any>('/arena/ideas', data);
}

export function voteIdea(id: string) {
  return httpClient.post<any>(`/arena/ideas/${id}/vote`, {});
}

export function sendChat(message: string) {
  return httpClient.post<any>('/arena/chat', { message });
}
