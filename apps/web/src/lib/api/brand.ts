import { httpClient } from './http-client';

/** Voz de Marca: identidad global del bot, aplicada en todos los canales. */
export interface BrandVoice {
  tono: string;
  publicoObjetivo: string;
  infoNegocio: string;
  reglas: string;
  emojis: boolean;
}

export function getBrandVoice() {
  return httpClient.get<BrandVoice>('/brand');
}

export function updateBrandVoice(data: Partial<BrandVoice>) {
  return httpClient.put<BrandVoice>('/brand', data);
}
