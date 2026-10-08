import { httpClient } from './http-client';

// Solicitudes de integración (lista de espera para integraciones aún no
// implementadas: Google Calendar, HubSpot, Sheets, etc.).

export function getIntegrationRequests() {
  return httpClient.get<{ requested: string[] }>('/integrations/requests');
}

export function setIntegrationRequest(name: string, requested: boolean) {
  return httpClient.post<{ requested: string[] }>('/integrations/requests', { name, requested });
}
