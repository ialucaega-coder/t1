import { httpClient } from './http-client';

export interface VoiceStatus {
  configured: boolean;
  language: string;
  voice: string;
  enabled: boolean;
  hint: string;
}

export interface VoiceConfig {
  enabled: boolean;
  assistantName: string;
  language: string;
  voice: string;
  rate: number;
  greeting: string;
  closing: string;
  reprompt: string;
  persona: string;
}

/** Estado de configuración del asistente de llamadas por voz. */
export function getStatus() {
  return httpClient.get<VoiceStatus>('/voice/status');
}

/** Config de voz del negocio (personalización del asistente). */
export function getConfig() {
  return httpClient.get<VoiceConfig>('/voice/config');
}

/** Guarda la config de voz del negocio. */
export function saveConfig(patch: Partial<VoiceConfig>) {
  return httpClient.put<VoiceConfig>('/voice/config', patch);
}
