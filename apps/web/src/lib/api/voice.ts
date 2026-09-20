import { httpClient } from './http-client';

export interface VoiceStatus {
  configured: boolean;
  language: string;
  voice: string;
  hint: string;
}

/** Estado de configuración del asistente de llamadas por voz. */
export function getStatus() {
  return httpClient.get<VoiceStatus>('/voice/status');
}
