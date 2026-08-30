import { httpClient } from './http-client';
import type { AIProvidersResponse, ChatbotResponse, ChatTurn, GeneratePromptResponse } from '@/types';

export function getProviders() {
  return httpClient.get<AIProvidersResponse>('/ai/providers');
}

export function sendChatMessage(message: string, history: ChatTurn[] = []) {
  return httpClient.post<ChatbotResponse>('/ai/chat', { message, channel: 'WEB', history });
}

export function generatePrompt(tone: 'formal' | 'amigable' | 'directo' = 'amigable') {
  return httpClient.post<GeneratePromptResponse>('/ai/generate-prompt', { tone });
}
