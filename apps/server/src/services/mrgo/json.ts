/**
 * Extracción defensiva de JSON de una respuesta de LLM.
 *
 * Lo comparten el orquestador (routing) y el loop agéntico (tool-calling): ambos
 * le piden al modelo responder SOLO un JSON, pero conviene tolerar que lo rodee
 * de texto. Intenta `JSON.parse` directo y, si falla, recorta desde la primera
 * `{` hasta la última `}`. Devuelve null si no hay un objeto JSON usable.
 */
export function extractJson(raw: string): Record<string, unknown> | null {
  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(s);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };

  const direct = tryParse((raw ?? '').trim());
  if (direct) return direct;

  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end > start) return tryParse(raw.slice(start, end + 1));
  return null;
}
