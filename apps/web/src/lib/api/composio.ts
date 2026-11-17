import { httpClient } from './http-client';

// Cliente del conector Composio. El http-client antepone /api, así que los
// paths acá son '/composio/...'.

// Estado de la conexión con Composio.
export interface CmpStatus {
  connected: boolean;
  enabled: boolean;
}

// Devuelve el estado actual de la conexión con Composio.
export function getCmpStatus() {
  return httpClient.get<CmpStatus>('/composio/status');
}

// Conecta (o reconfigura) Composio con la API key. Lanza (400) si la API key
// es inválida.
export function connectCmp(apiKey: string) {
  return httpClient.post<CmpStatus>('/composio/connect', { apiKey });
}

// Desconecta Composio.
export function disconnectCmp() {
  return httpClient.post<CmpStatus>('/composio/disconnect', {});
}
