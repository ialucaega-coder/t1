import { httpClient } from './http-client';

// Cliente del conector ManyChat. El http-client antepone /api, así que los
// paths acá son '/manychat/...'.

// Estado de la conexión con ManyChat.
export interface McStatus {
  connected: boolean;
  enabled: boolean;
}

// Devuelve el estado actual de la conexión con ManyChat.
export function getMcStatus() {
  return httpClient.get<McStatus>('/manychat/status');
}

// Conecta (o reconfigura) ManyChat con la API key. Lanza (400) si la API key
// es inválida.
export function connectMc(apiKey: string) {
  return httpClient.post<McStatus>('/manychat/connect', { apiKey });
}

// Desconecta ManyChat.
export function disconnectMc() {
  return httpClient.post<McStatus>('/manychat/disconnect', {});
}
