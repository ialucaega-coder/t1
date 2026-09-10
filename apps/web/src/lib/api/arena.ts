import { httpClient } from './http-client';
import type {
  ArenaBuilder,
  CreateBuilderInput,
  ArenaIdea,
  CreateIdeaInput,
  ArenaChatResponse,
} from '@/types/arena';

export function getBuilders() {
  return httpClient.get<ArenaBuilder[]>('/arena/builders');
}

export function createBuilder(data: CreateBuilderInput) {
  return httpClient.post<ArenaBuilder>('/arena/builders', data);
}

export function updateBuilder(id: string, data: Partial<CreateBuilderInput>) {
  return httpClient.patch<ArenaBuilder>(`/arena/builders/${id}`, data);
}

export function deleteBuilder(id: string) {
  return httpClient.delete<void>(`/arena/builders/${id}`);
}

export function getIdeas() {
  return httpClient.get<ArenaIdea[]>('/arena/ideas');
}

export function createIdea(data: CreateIdeaInput) {
  return httpClient.post<ArenaIdea>('/arena/ideas', data);
}

export function voteIdea(id: string) {
  return httpClient.post<ArenaIdea>(`/arena/ideas/${id}/vote`, {});
}

export function sendChat(message: string) {
  return httpClient.post<ArenaChatResponse>('/arena/chat', { message });
}
