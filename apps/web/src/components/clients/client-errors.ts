/**
 * Mensaje a mostrar ante un error de la API. El http-client lanza `Error` con el
 * `error` que devuelve el server (ej. "Ya existe un cliente con ese email" o el
 * aviso de límite de contactos del plan), así que lo usamos tal cual; si no hay
 * mensaje útil, caemos al texto genérico.
 */
export function clientErrorMessage(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message.trim() : '';
  if (!msg || msg === 'Request failed' || /^HTTP \d+$/.test(msg)) return fallback;
  return msg;
}
