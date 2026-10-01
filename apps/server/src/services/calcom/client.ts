/**
 * Cliente mínimo de la API de Cal.com (v1).
 *
 * Host fijo `api.cal.com` (sin SSRF: la URL no se arma con input del usuario más
 * allá de la query de la API key). Autenticación por `?apiKey=`. Cada request
 * tiene timeout para no colgar el flujo que lo llama.
 */
const CALCOM_API_BASE = 'https://api.cal.com/v1';
const REQUEST_TIMEOUT_MS = 10_000;

export interface CalcomEventType {
  id: number;
  title: string;
  slug: string;
  length: number;
}

async function calcomFetch(path: string, apiKey: string, init?: RequestInit): Promise<Response> {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${CALCOM_API_BASE}${path}${sep}apiKey=${encodeURIComponent(apiKey)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Valida la API key contra Cal.com (GET /me). Devuelve true si es válida. */
export async function testApiKey(apiKey: string): Promise<boolean> {
  try {
    const res = await calcomFetch('/me', apiKey);
    return res.ok;
  } catch {
    return false;
  }
}

/** Lista los tipos de evento del usuario para que elija cuál usar. */
export async function listEventTypes(apiKey: string): Promise<CalcomEventType[]> {
  const res = await calcomFetch('/event-types', apiKey);
  if (!res.ok) throw new Error(`Cal.com respondió ${res.status}`);
  const data = (await res.json()) as { event_types?: CalcomEventType[] };
  return (data.event_types || []).map((e) => ({
    id: e.id,
    title: e.title,
    slug: e.slug,
    length: e.length,
  }));
}

export interface CalcomBookingInput {
  eventTypeId: number;
  start: string; // ISO 8601
  name: string;
  email: string;
  timeZone?: string;
}

/** Crea una reserva en Cal.com. Lanza si la API responde con error. */
export async function createBooking(apiKey: string, input: CalcomBookingInput): Promise<{ id: number } | null> {
  const res = await calcomFetch('/bookings', apiKey, {
    method: 'POST',
    body: JSON.stringify({
      eventTypeId: input.eventTypeId,
      start: input.start,
      responses: { name: input.name, email: input.email },
      timeZone: input.timeZone || 'America/Argentina/Buenos_Aires',
      language: 'es',
      metadata: {},
    }),
  });
  if (!res.ok) throw new Error(`Cal.com rechazó la reserva (${res.status})`);
  const data = (await res.json()) as { booking?: { id: number }; id?: number };
  const id = data.booking?.id ?? data.id;
  return typeof id === 'number' ? { id } : null;
}
