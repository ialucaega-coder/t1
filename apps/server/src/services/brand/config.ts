/**
 * Servicio de "Voz de Marca".
 *
 * La Voz de Marca es la personalidad global del bot: tono, público objetivo,
 * información/FAQ del negocio, reglas propias y uso de emojis. Se aplica a
 * TODOS los canales (web, WhatsApp, Telegram, voz) inyectándose en el prompt
 * de sistema del chatbot (ver services/chatbot.ts).
 *
 * Persistencia: como no se puede tocar el schema de Prisma, guardamos la
 * config en el modelo `Connection` con type='BRAND' (un registro por negocio),
 * reutilizando el campo `config Json?`. Es el mismo patrón que usan los
 * proveedores de IA (type='ai_provider') en routes/settings.ts.
 */
import { prisma } from '../../lib/prisma';

const BRAND_CONNECTION_TYPE = 'BRAND';
const BRAND_CONNECTION_NAME = 'Voz de Marca';

/** Configuración editable de la Voz de Marca de un negocio. */
export interface BrandVoice {
  /** Tono/estilo de comunicación (ej: "cercano y profesional"). */
  tono: string;
  /** A quién le habla el bot (ej: "dueños de PyMEs en Argentina"). */
  publicoObjetivo: string;
  /** Conocimiento/FAQ del negocio en texto libre para que el bot responda. */
  infoNegocio: string;
  /** Reglas propias del negocio que el bot siempre debe respetar. */
  reglas: string;
  /** Si el bot puede usar emojis en sus respuestas. */
  emojis: boolean;
}

/** Valores por defecto cuando el negocio todavía no configuró su Voz de Marca. */
export const DEFAULT_BRAND_VOICE: BrandVoice = {
  tono: '',
  publicoObjetivo: '',
  infoNegocio: '',
  reglas: '',
  emojis: true,
};

function normalize(config: unknown): BrandVoice {
  const cfg = (config && typeof config === 'object' && !Array.isArray(config))
    ? (config as Record<string, unknown>)
    : {};
  return {
    tono: typeof cfg.tono === 'string' ? cfg.tono : DEFAULT_BRAND_VOICE.tono,
    publicoObjetivo: typeof cfg.publicoObjetivo === 'string' ? cfg.publicoObjetivo : DEFAULT_BRAND_VOICE.publicoObjetivo,
    infoNegocio: typeof cfg.infoNegocio === 'string' ? cfg.infoNegocio : DEFAULT_BRAND_VOICE.infoNegocio,
    reglas: typeof cfg.reglas === 'string' ? cfg.reglas : DEFAULT_BRAND_VOICE.reglas,
    emojis: typeof cfg.emojis === 'boolean' ? cfg.emojis : DEFAULT_BRAND_VOICE.emojis,
  };
}

/** Devuelve la Voz de Marca del negocio (o los valores por defecto). */
export async function loadBrandVoice(businessId: string): Promise<BrandVoice> {
  const conn = await prisma.connection.findFirst({
    where: { businessId, type: BRAND_CONNECTION_TYPE },
  });
  return normalize(conn?.config);
}

/**
 * Guarda (merge) un parche parcial de la Voz de Marca. Crea el registro
 * Connection type='BRAND' si todavía no existe.
 */
export async function saveBrandVoice(businessId: string, patch: Partial<BrandVoice>): Promise<BrandVoice> {
  const existing = await prisma.connection.findFirst({
    where: { businessId, type: BRAND_CONNECTION_TYPE },
  });
  const current = normalize(existing?.config);
  const next: BrandVoice = { ...current, ...patch };

  if (existing) {
    await prisma.connection.update({
      where: { id: existing.id },
      data: { config: next as unknown as object, isActive: true },
    });
  } else {
    await prisma.connection.create({
      data: {
        name: BRAND_CONNECTION_NAME,
        type: BRAND_CONNECTION_TYPE,
        icon: 'Sparkles',
        isActive: true,
        config: next as unknown as object,
        businessId,
      },
    });
  }
  return next;
}

/**
 * Convierte la Voz de Marca en un fragmento de prompt de sistema listo para
 * inyectar. Devuelve '' si no hay nada configurado, para no ensuciar el prompt.
 *
 * @param reforzar  Si el superpoder "Voz de marca" está activo, se agrega una
 *                  instrucción extra para que el bot priorice esta identidad.
 */
export function buildBrandVoicePrompt(voice: BrandVoice, reforzar = false): string {
  const lines: string[] = [];

  if (voice.tono.trim()) {
    lines.push(`Tono y estilo de comunicación: ${voice.tono.trim()}.`);
  }
  if (voice.publicoObjetivo.trim()) {
    lines.push(`Público objetivo (a quién le hablás): ${voice.publicoObjetivo.trim()}.`);
  }
  if (voice.reglas.trim()) {
    lines.push(`Reglas propias del negocio que SIEMPRE debés respetar: ${voice.reglas.trim()}`);
  }
  if (voice.infoNegocio.trim()) {
    lines.push(
      'Información y preguntas frecuentes del negocio (usala como fuente de verdad para responder):\n' +
      voice.infoNegocio.trim(),
    );
  }
  lines.push(
    voice.emojis
      ? 'Podés usar emojis con moderación para dar calidez, sin abusar.'
      : 'No uses emojis en tus respuestas.',
  );

  if (lines.length === 0) return '';

  const header = reforzar
    ? 'VOZ DE MARCA (PRIORITARIA — mantené esta identidad en todos los canales por encima de otros estilos):'
    : 'VOZ DE MARCA (identidad del negocio, aplicá en todos los canales):';

  return [header, ...lines].join('\n');
}
