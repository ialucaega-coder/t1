import { httpClient } from './http-client';

// ────────────────────────────────────────────────────────────────
// API client para conexiones (Telegram, WhatsApp, etc.)
// ────────────────────────────────────────────────────────────────

export interface TelegramStatus {
  connected: boolean;
  bot: {
    username: string | null;
    name: string | null;
    connectedAt: string | null;
  } | null;
}

export interface TelegramConnectResponse {
  success: boolean;
  bot: {
    username: string;
    name: string;
  };
  webhookUrl: string;
}

export function getTelegramStatus() {
  return httpClient.get<TelegramStatus>('/telegram/status');
}

export function connectTelegram(botToken: string) {
  return httpClient.post<TelegramConnectResponse>('/telegram/connect', { botToken });
}

export function disconnectTelegram() {
  return httpClient.delete<{ success: boolean; message: string }>('/telegram/disconnect');
}
