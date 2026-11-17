import { httpClient } from './http-client';

// Cliente del conector Cal.com (agenda externa). El http-client antepone /api,
// así que los paths acá son '/calcom/...'.

// Estado de la conexión con Cal.com.
export interface CalcomStatus {
  connected: boolean;
  enabled: boolean;
  eventTypeId: number | null;
}

// Tipo de evento de Cal.com (lo que el cliente puede reservar).
export interface CalcomEventType {
  id: number;
  title: string;
  slug: string;
  length: number;
}

// Devuelve el estado actual de la conexión con Cal.com.
export function getCalcomStatus() {
  return httpClient.get<CalcomStatus>('/calcom/status');
}

// Lista los tipos de evento de la cuenta conectada.
// La API responde 400 si todavía no está conectada.
export function getCalcomEventTypes() {
  return httpClient.get<{ eventTypes: CalcomEventType[] }>('/calcom/event-types');
}

// Conecta (o reconfigura) Cal.com con la API key. Opcionalmente fija el
// eventTypeId a usar. Lanza (400) si la API key es inválida.
export function connectCalcom(apiKey: string, eventTypeId?: number) {
  return httpClient.post<CalcomStatus>('/calcom/connect', {
    apiKey,
    ...(eventTypeId != null ? { eventTypeId } : {}),
  });
}

// Desconecta Cal.com.
export function disconnectCalcom() {
  return httpClient.post<CalcomStatus>('/calcom/disconnect', {});
}
