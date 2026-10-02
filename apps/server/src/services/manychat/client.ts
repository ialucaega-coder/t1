/**
 * Cliente mínimo de la API de ManyChat.
 *
 * Host fijo `api.manychat.com` (sin SSRF). Autenticación por Bearer API key.
 * Cada request tiene timeout para no colgar el flujo que lo llama.
 */
const MC_API_BASE = 'https://api.manychat.com';
const REQUEST_TIMEOUT_MS = 10_000;

async function mcFetch(path: string, apiKey: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${MC_API_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...(init?.headers || {}),
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Valida la API key contra ManyChat (GET /fb/page/getInfo). */
export async function testApiKey(apiKey: string): Promise<boolean> {
  try {
    const res = await mcFetch('/fb/page/getInfo', apiKey);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Envía un mensaje de texto a un suscriptor de ManyChat.
 * Lanza si la API responde con error.
 */
export async function sendText(apiKey: string, subscriberId: string, text: string): Promise<void> {
  const res = await mcFetch('/fb/sending/sendContent', apiKey, {
    method: 'POST',
    body: JSON.stringify({
      subscriber_id: subscriberId,
      data: {
        version: 'v2',
        content: { messages: [{ type: 'text', text }] },
      },
      message_tag: 'ACCOUNT_UPDATE',
    }),
  });
  if (!res.ok) throw new Error(`ManyChat rechazó el envío (${res.status})`);
}
