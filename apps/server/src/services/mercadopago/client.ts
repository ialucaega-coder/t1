/**
 * Cliente mínimo de la API de MercadoPago.
 *
 * Host fijo `api.mercadopago.com` (sin SSRF). Autenticación por Bearer access
 * token. Cada request tiene timeout para no colgar el flujo que lo llama.
 */
const MP_API_BASE = 'https://api.mercadopago.com';
const REQUEST_TIMEOUT_MS = 10_000;

async function mpFetch(path: string, accessToken: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${MP_API_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...(init?.headers || {}),
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Valida el access token contra MercadoPago (GET /users/me). */
export async function testAccessToken(accessToken: string): Promise<boolean> {
  try {
    const res = await mpFetch('/users/me', accessToken);
    return res.ok;
  } catch {
    return false;
  }
}

export interface PaymentPreferenceInput {
  title: string;
  amount: number;
  currency: string;
  quantity?: number;
}

/**
 * Crea una preferencia de pago (Checkout Pro) y devuelve el link de cobro
 * (`init_point`). Lanza si MercadoPago responde con error.
 */
export async function createPaymentPreference(
  accessToken: string,
  input: PaymentPreferenceInput,
): Promise<{ id: string; initPoint: string }> {
  const res = await mpFetch('/checkout/preferences', accessToken, {
    method: 'POST',
    body: JSON.stringify({
      items: [
        {
          title: input.title,
          quantity: input.quantity ?? 1,
          unit_price: input.amount,
          currency_id: input.currency,
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`MercadoPago rechazó la preferencia (${res.status})`);
  const data = (await res.json()) as { id?: string; init_point?: string };
  if (!data.id || !data.init_point) throw new Error('MercadoPago no devolvió un link de pago');
  return { id: data.id, initPoint: data.init_point };
}
