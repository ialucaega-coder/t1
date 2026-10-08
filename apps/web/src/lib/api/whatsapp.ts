import { httpClient } from './http-client';

// WhatsApp vía Twilio: el webhook entrante lo procesa el bot y el envío saliente
// usa /whatsapp/send. `configured` indica si el servidor tiene credenciales de
// Twilio cargadas (variables de entorno).

export function getWhatsAppStatus() {
  return httpClient.get<{ configured: boolean }>('/whatsapp/status');
}

export function sendWhatsApp(to: string, message: string) {
  return httpClient.post<{ success: boolean; sid: string }>('/whatsapp/send', { to, message });
}
