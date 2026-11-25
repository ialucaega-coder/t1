import { httpClient } from './http-client';

// ────────────────────────────────────────────────────────────────
// API client para canales de Meta (Instagram Direct + Messenger)
// ────────────────────────────────────────────────────────────────

export type MetaPlatform = 'instagram' | 'messenger';

export interface MetaPlatformStatus {
  connected: boolean;
  name?: string;
  pageId?: string | null;
  igId?: string | null;
  connectedAt?: string | null;
}

export interface MetaStatus {
  configured: boolean;
  instagram: MetaPlatformStatus;
  messenger: MetaPlatformStatus;
}

export interface MetaConnectInput {
  platform: MetaPlatform;
  pageAccessToken: string;
  /** Requerido para Messenger. */
  pageId?: string;
  /** Requerido para Instagram. */
  igId?: string;
  pageName?: string;
}

export function getMetaStatus() {
  return httpClient.get<MetaStatus>('/meta/status');
}

export function connectMeta(input: MetaConnectInput) {
  return httpClient.post<{ success: boolean; platform: MetaPlatform; botId: string }>('/meta/connect', input);
}

export function disconnectMeta(platform: MetaPlatform) {
  return httpClient.delete<{ success: boolean; message: string }>(`/meta/disconnect?platform=${platform}`);
}
