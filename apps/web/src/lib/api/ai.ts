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

// ── Motor de IA (multi-proveedor) ──────────────────────────────────────

export interface AIEngineStatus {
  id: string;
  name: string;
  provider: string;
  model?: string;
  type: 'api' | 'local';
  vision: boolean;
  kind: 'anthropic' | 'openai-compatible';
  icon?: string;
  active: boolean;
  hasOwnKey: boolean;
  relayAvailable: boolean;
  local: boolean;
  ready: boolean;
}

export interface EnginesResponse {
  activeEngineId: string;
  engines: AIEngineStatus[];
}

export function getEngines() {
  return httpClient.get<EnginesResponse>('/ai/engines');
}

export function setEngine(engineId: string) {
  return httpClient.put<{ success: boolean; activeEngineId: string }>('/ai/engine', { engineId });
}

export function setEngineKey(provider: string, apiKey: string) {
  return httpClient.put<{ success: boolean }>('/ai/keys', { provider, apiKey });
}
