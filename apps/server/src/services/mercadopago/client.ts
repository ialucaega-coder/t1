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
  /** Identificador nuestro del cobro: MercadoPago lo devuelve en el pago. */
  externalReference?: string;
  /** URL pública a la que MercadoPago avisa los cambios de estado del pago. */
  notificationUrl?: string;
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
      ...(input.externalReference ? { external_reference: input.externalReference } : {}),
      ...(input.notificationUrl ? { notification_url: input.notificationUrl } : {}),
    }),
  });
  if (!res.ok) throw new Error(`MercadoPago rechazó la preferencia (${res.status})`);
  const data = (await res.json()) as { id?: string; init_point?: string };
  if (!data.id || !data.init_point) throw new Error('MercadoPago no devolvió un link de pago');
  return { id: data.id, initPoint: data.init_point };
}

/** Subconjunto de los campos de un pago de MercadoPago que usamos. */
export interface MpPayment {
  id: string;
  status: string;
  /** Monto real cobrado (transaction_amount). */
  amount: number;
  currency: string | null;
  externalReference: string | null;
  /** payment_type_id: credit_card, debit_card, bank_transfer, account_money, ticket... */
  paymentType: string | null;
}

/** Fallo transitorio (red, timeout, 5xx, 429): conviene que MercadoPago reintente. */
export class MpTransientError extends Error {}

/**
 * Consulta un pago REAL a MercadoPago (GET /v1/payments/{id}) con el access token
 * del negocio. Es la verificación anti-falsificación del webhook: el cuerpo que
 * llega a nuestra ruta pública no es confiable, la API sí.
 *
 * Devuelve `null` si MercadoPago no reconoce ese pago para este token (404, o
 * 400/401/403: el pago es de otra cuenta o el token ya no sirve). Lanza
 * `MpTransientError` ante errores que vale la pena reintentar.
 */
export async function fetchPayment(accessToken: string, paymentId: string): Promise<MpPayment | null> {
  let res: Response;
  try {
    res = await mpFetch(`/v1/payments/${encodeURIComponent(paymentId)}`, accessToken);
  } catch (err) {
    throw new MpTransientError(`No se pudo consultar el pago a MercadoPago: ${(err as Error).message}`);
  }
  if (res.status === 404 || res.status === 400 || res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new MpTransientError(`MercadoPago respondió ${res.status} al consultar el pago`);

  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new MpTransientError('MercadoPago devolvió una respuesta ilegible al consultar el pago');
  }
  if (!data || typeof data !== 'object' || data.id == null) return null;

  const amount = Number(data.transaction_amount);
  return {
    id: String(data.id),
    status: typeof data.status === 'string' ? data.status : '',
    amount: Number.isFinite(amount) ? amount : 0,
    currency: typeof data.currency_id === 'string' ? data.currency_id : null,
    externalReference: typeof data.external_reference === 'string' ? data.external_reference : null,
    paymentType: typeof data.payment_type_id === 'string' ? data.payment_type_id : null,
  };
}
