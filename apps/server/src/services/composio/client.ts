/**
 * Cliente mínimo de la API de Composio.
 *
 * Host fijo `backend.composio.dev` (sin SSRF). Autenticación por header
 * `x-api-key`. Cada request tiene timeout para no colgar el flujo que lo llama.
 */
const CMP_API_BASE = 'https://backend.composio.dev';
const REQUEST_TIMEOUT_MS = 10_000;

async function cmpFetch(path: string, apiKey: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${CMP_API_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        ...(init?.headers || {}),
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Valida la API key contra Composio (GET /api/v3/auth/session/info, que
 * devuelve la info de la sesión autenticada). Devuelve false ante cualquier
 * fallo (key inválida, red caída o timeout).
 */
export async function testApiKey(apiKey: string): Promise<boolean> {
  try {
    const res = await cmpFetch('/api/v3/auth/session/info', apiKey);
    return res.ok;
  } catch {
    return false;
  }
}
