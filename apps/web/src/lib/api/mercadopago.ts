import { httpClient } from './http-client';

// Cliente del conector MercadoPago (pagos / Checkout Pro). El http-client
// antepone /api, así que los paths acá son '/mercadopago/...'.

// Estado de la conexión con MercadoPago.
export interface MpStatus {
  connected: boolean;
  enabled: boolean;
  currency: string;
}

// Resultado de generar un link de pago.
export interface MpPaymentLink {
  url: string;
  id: string;
}

// Devuelve el estado actual de la conexión con MercadoPago.
export function getMpStatus() {
  return httpClient.get<MpStatus>('/mercadopago/status');
}

// Conecta (o reconfigura) MercadoPago con el access token. Opcionalmente fija
// la moneda (3 letras). Lanza (400) si el access token es inválido.
export function connectMp(accessToken: string, currency?: string) {
  return httpClient.post<MpStatus>('/mercadopago/connect', {
    accessToken,
    ...(currency ? { currency } : {}),
  });
}

// Desconecta MercadoPago.
export function disconnectMp() {
  return httpClient.post<MpStatus>('/mercadopago/disconnect', {});
}

// Genera un link de pago (Checkout Pro). La API responde 400 si todavía no
// está conectada. La moneda es opcional (si se omite se usa la configurada).
export function createMpPaymentLink(amount: number, description: string, currency?: string) {
  return httpClient.post<MpPaymentLink>('/mercadopago/payment-link', {
    amount,
    description,
    ...(currency ? { currency } : {}),
  });
}
