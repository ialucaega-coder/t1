/**
 * Configuración del asistente de voz, por negocio.
 *
 * Se persiste en el modelo `Connection` (type: 'VOICE') usando su campo
 * `config` (Json), así que no requiere cambios de schema. Cada negocio puede
 * personalizar nombre, saludo, tono, idioma, voz y mensajes del asistente.
 */
import { prisma } from '../../lib/prisma';

export interface VoiceSettings {
  /** Si está activo, el asistente atiende llamadas. */
  enabled: boolean;
  /** Nombre del asistente (ej: "Sofía"). */
  assistantName: string;
  /** Idioma de la llamada (STT/TTS): es-MX, es-AR, es-ES, en-US, ... */
  language: string;
  /** Voz de Amazon Polly usada por Twilio en la llamada real. */
  voice: string;
  /** Velocidad de habla para la demo del panel (0.5–1.5). */
  rate: number;
  /** Saludo inicial. Admite {negocio} y {asistente}. */
  greeting: string;
  /** Frase de despedida al cerrar la llamada. */
  closing: string;
  /** Qué decir cuando no se entiende / no hay respuesta. */
  reprompt: string;
  /** Personalidad y reglas extra que se inyectan al cerebro de IA. */
  persona: string;
}

const CONNECTION_TYPE = 'VOICE';

/** Config por defecto, derivada del nombre del negocio. */
export function defaultVoiceSettings(businessName = 'nuestro negocio'): VoiceSettings {
  return {
    enabled: true,
    assistantName: 'Asistente',
    language: process.env.VOICE_LANGUAGE || 'es-MX',
    voice: process.env.VOICE_TTS_VOICE || 'Polly.Mia',
    rate: 1,
    greeting: `Hola, gracias por comunicarte con ${businessName}. Soy {asistente}, el asistente virtual. ¿En qué puedo ayudarte?`,
    closing: 'Gracias por llamar. ¡Que tengas un buen día!',
    reprompt: 'Perdón, no te escuché bien. ¿Me repetís, por favor?',
    persona:
      'Hablás de forma cálida, breve y natural, como una persona real por teléfono. Evitás respuestas largas.',
  };
}

/** Interpola {negocio} y {asistente} en un texto. */
export function interpolate(text: string, businessName: string, assistantName: string): string {
  return (text || '')
    .replace(/\{negocio\}/gi, businessName)
    .replace(/\{asistente\}/gi, assistantName);
}

/**
 * Carga la config de voz de un negocio, combinando lo guardado con los
 * valores por defecto (así nunca faltan campos aunque se guarde parcial).
 */
export async function loadVoiceSettings(businessId: string): Promise<VoiceSettings> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { name: true },
  });
  const defaults = defaultVoiceSettings(business?.name || 'nuestro negocio');

  const conn = await prisma.connection.findFirst({
    where: { businessId, type: CONNECTION_TYPE },
    select: { config: true },
  });

  const saved = (conn?.config as Partial<VoiceSettings> | null) || {};
  return { ...defaults, ...saved };
}

/**
 * Guarda (upsert) la config de voz de un negocio.
 *
 * Atómico: corre en una transacción y bloquea la fila con `SELECT ... FOR
 * UPDATE`, re-leyendo el config fresco antes de mergear el parche, para que dos
 * guardados concurrentes no se pisen (lost-update). El nombre del negocio (para
 * los defaults) se lee fuera del lock porque no depende del config.
 */
export async function saveVoiceSettings(
  businessId: string,
  patch: Partial<VoiceSettings>
): Promise<VoiceSettings> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { name: true },
  });
  const defaults = defaultVoiceSettings(business?.name || 'nuestro negocio');

  return prisma.$transaction(async (tx) => {
    let conn = await tx.connection.findFirst({
      where: { businessId, type: CONNECTION_TYPE },
      select: { id: true },
    });

    if (!conn) {
      conn = await tx.connection.create({
        data: {
          businessId,
          name: 'Asistente de Voz',
          type: CONNECTION_TYPE,
          icon: 'phone',
          isActive: defaults.enabled,
          config: defaults as object,
        },
        select: { id: true },
      });
    } else {
      await tx.$queryRaw`SELECT id FROM "connections" WHERE id = ${conn.id} FOR UPDATE`;
    }

    const fresh = await tx.connection.findUnique({ where: { id: conn.id }, select: { config: true } });
    const saved = (fresh?.config as Partial<VoiceSettings> | null) || {};
    const next: VoiceSettings = { ...defaults, ...saved, ...patch };

    await tx.connection.update({
      where: { id: conn.id },
      data: { config: next as object, isActive: next.enabled },
    });
    return next;
  });
}
