import { httpClient } from './http-client';

/**
 * Base de conocimiento / FAQ del bot: lista estructurada pregunta→respuesta que
 * el bot usa como fuente de verdad para las consultas más comunes del negocio.
 * Se aplica en todos los canales (se inyecta en el prompt de sistema).
 */
export interface FaqItem {
  id?: string;
  question: string;
  answer: string;
}

/** Topes del backend (reflejados acá para validar/limitar en la UI). */
export const MAX_FAQ_ITEMS = 100;
export const MAX_QUESTION_LEN = 300;
export const MAX_ANSWER_LEN = 1500;

export function getFaq() {
  return httpClient.get<{ items: FaqItem[] }>('/faq');
}

export function saveFaq(items: FaqItem[]) {
  return httpClient.put<{ items: FaqItem[] }>('/faq', { items });
}
