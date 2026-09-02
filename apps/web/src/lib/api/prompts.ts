import { httpClient } from './http-client';
import type { Prompt } from '@/constants/prompts';

export function getPrompts() {
  return httpClient.get<Prompt[]>('/prompts');
}

export function createPrompt(data: Partial<Prompt>) {
  return httpClient.post<Prompt>('/prompts', data);
}

export function updatePrompt(id: string, data: Partial<Prompt>) {
  return httpClient.put<Prompt>(`/prompts/${id}`, data);
}

export function deletePrompt(id: string) {
  return httpClient.delete<{ success: boolean }>(`/prompts/${id}`);
}
