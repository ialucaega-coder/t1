import { httpClient } from './http-client';
import type { AIProvidersResponse, ChatbotResponse, ChatTurn, GeneratePromptResponse } from '@/types';

export function getProviders() {
  return httpClient.get<AIProvidersResponse>('/ai/providers');
}

export function sendChatMessage(message: string, history: ChatTurn[] = [], conversationId?: string) {
  // Con conversationId el server sigue la misma conversación en vez de abrir una nueva por mensaje.
  return httpClient.post<ChatbotResponse>('/ai/chat', { message, channel: 'WEB', history, ...(conversationId ? { conversationId } : {}) });
}

export function generatePrompt(tone: 'formal' | 'amigable' | 'directo' = 'amigable') {
  return httpClient.post<GeneratePromptResponse>('/ai/generate-prompt', { tone });
}

// ── Prompt de sistema personalizado (persistido en Connection type='SYSTEM_PROMPT') ──

export function getSystemPrompt() {
  return httpClient.get<{ prompt: string }>('/ai/system-prompt');
}

export function saveSystemPrompt(prompt: string) {
  return httpClient.put<{ prompt: string }>('/ai/system-prompt', { prompt });
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

// ── FinOps: consumo de IA (tokens + costo estimado) ────────────────────

export interface UsageByModel {
  model: string;
  inputTokens: number;
  outputTokens: number;
  messages: number;
  estimatedCostUsd: number;
}
export interface UsageByDay {
  day: string;
  inputTokens: number;
  outputTokens: number;
  messages: number;
  estimatedCostUsd: number;
}
export interface UsageSummary {
  rangeDays: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalMessages: number;
  estimatedCostUsd: number;
  byDay: UsageByDay[];
  byModel: UsageByModel[];
}

export function getUsage(days = 30) {
  return httpClient.get<UsageSummary>(`/ai/usage?days=${days}`);
}

export interface MessageQuota {
  used: number;
  limit: number;
  remaining: number;
  overQuota: boolean;
  periodStart: string;
  periodEnd: string | null;
  plan: string | null;
}

export function getQuota() {
  return httpClient.get<MessageQuota>('/ai/quota');
}

// ── Tope mensual de gasto de IA ────────────────────────────────────────

export type SpendLevel = 'ok' | 'warn' | 'blocked';

export interface SpendStatus {
  /** null = sin tope. */
  capUsd: number | null;
  /** Gasto estimado del mes en USD (real aunque no haya tope). */
  spentUsd: number;
  /** 0..n (puede pasar de 1). null cuando no hay tope. */
  ratio: number | null;
  level: SpendLevel;
  month: string;
}

export function getSpendCap() {
  return httpClient.get<SpendStatus>('/ai/spend-cap');
}

/** Solo ADMIN. `null` quita el tope. */
export function setSpendCap(capUsd: number | null) {
  return httpClient.put<SpendStatus>('/ai/spend-cap', { capUsd });
}

export interface SpendOverviewRow {
  businessId: string;
  name: string;
  spentUsd: number;
  capUsd: number | null;
  /** null cuando el negocio no tiene tope. */
  ratio: number | null;
  level: SpendLevel;
}

export interface SpendOverview {
  month: string;
  totalUsd: number;
  businesses: SpendOverviewRow[];
}

/** Solo platform admin. */
export function getSpendOverview() {
  return httpClient.get<SpendOverview>('/ai/spend-overview');
}
