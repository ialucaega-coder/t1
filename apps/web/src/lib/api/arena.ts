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

export function voteBuilder(id: string) {
  return httpClient.post<ArenaBuilder>(`/arena/builders/${id}/vote`, {});
}

/**
 * Chat de prueba. Con `builderId` el server suma el systemPrompt de ese builder (de este
 * negocio) al del bot; sin él prueba el bot tal cual está configurado.
 */
export function sendChat(message: string, conversationId?: string, builderId?: string) {
  const body: { message: string; conversationId?: string; builderId?: string } = { message };
  if (conversationId) body.conversationId = conversationId;
  if (builderId) body.builderId = builderId;
  return httpClient.post<ArenaChatResponse>('/arena/chat', body);
}
