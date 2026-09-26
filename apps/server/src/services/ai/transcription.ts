/**
 * Transcripción de audio (superpoder "Oído y vista" — la parte de "oído").
 *
 * Usa Whisper de OpenAI (`whisper-1`). El SDK ya está instalado en el monorepo.
 * Es OPCIONAL en runtime: si no hay `OPENAI_API_KEY`, o la descarga/transcripción
 * falla, devolvemos `null` y el canal sigue funcionando (el mensaje se procesa
 * como "(audio adjunto)"). Nunca lanza: los callers (webhooks) no deben romperse
 * por un audio.
 *
 * A diferencia de la visión (que Anthropic resuelve por URL), la transcripción
 * necesita bajar el archivo primero. Para Twilio hace falta Basic auth; para Meta
 * las URLs son públicas. Por eso `transcribeAudioFromUrl` acepta headers opcionales.
 */
import OpenAI, { toFile } from 'openai';

const WHISPER_MODEL = 'whisper-1';
/** Tope de audio que aceptamos bajar/transcribir (Whisper admite hasta 25 MB). */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

let cachedClient: OpenAI | null = null;

/** ¿Está disponible la transcripción? (depende de la API key de OpenAI). */
export function isTranscriptionAvailable(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

function getClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!cachedClient) {
    cachedClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return cachedClient;
}

/** Deriva un nombre de archivo con extensión a partir del content-type del audio. */
function filenameForMime(mime: string | undefined): string {
  const map: Record<string, string> = {
    'audio/ogg': 'audio.ogg',
    'audio/opus': 'audio.ogg',
    'audio/mpeg': 'audio.mp3',
    'audio/mp3': 'audio.mp3',
    'audio/mp4': 'audio.mp4',
    'audio/m4a': 'audio.m4a',
    'audio/x-m4a': 'audio.m4a',
    'audio/wav': 'audio.wav',
    'audio/webm': 'audio.webm',
    'audio/amr': 'audio.amr',
  };
  const base = (mime || '').split(';')[0].trim().toLowerCase();
  return map[base] || 'audio.ogg';
}

/**
 * Transcribe un buffer de audio ya descargado. Devuelve el texto o `null` si no
 * hay cliente o falla. `mediaType` ayuda a elegir la extensión del archivo.
 */
export async function transcribeAudioBuffer(buffer: Buffer, mediaType?: string): Promise<string | null> {
  const client = getClient();
  if (!client) return null;
  if (!buffer || buffer.length === 0 || buffer.length > MAX_AUDIO_BYTES) return null;

  try {
    const file = await toFile(buffer, filenameForMime(mediaType), { type: mediaType || 'audio/ogg' });
    const result = await client.audio.transcriptions.create({ file, model: WHISPER_MODEL });
    const text = (result?.text || '').trim();
    return text || null;
  } catch (error) {
    console.error('Error transcribiendo audio:', error);
    return null;
  }
}

/**
 * Descarga un audio por URL y lo transcribe. `headers` opcionales para fuentes
 * autenticadas (ej: Basic auth de Twilio). Devuelve `null` ante cualquier fallo.
 */
export async function transcribeAudioFromUrl(
  url: string,
  opts: { headers?: Record<string, string>; mediaType?: string } = {},
): Promise<string | null> {
  if (!isTranscriptionAvailable() || !url) return null;

  try {
    const res = await fetch(url, opts.headers ? { headers: opts.headers } : undefined);
    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') || opts.mediaType || 'audio/ogg';
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_AUDIO_BYTES) return null;

    return await transcribeAudioBuffer(buf, contentType);
  } catch (error) {
    console.error('Error descargando/transcribiendo audio:', error);
    return null;
  }
}
