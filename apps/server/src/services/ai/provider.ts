/**
 * Interfaz abstracta para proveedores de IA.
 *
 * Cualquier proveedor (Claude, ChatGPT, Gemini, Grok, etc.) debe implementar
 * esta interfaz para poder conectarse al chatbot. Esto permite intercambiar
 * el "cerebro" del bot sin tocar el resto del sistema (patrón plug-and-play).
 */

/** Un turno de conversación individual (usuario o asistente). */
export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Imagen adjunta a un mensaje del usuario (superpoder "Oído y vista" — visión).
 * Se puede pasar por URL pública (http/https) o por base64 embebido.
 * `mediaType` es opcional para base64 (ej: "image/jpeg"); si no se pasa, se
 * asume "image/jpeg". Para URLs no hace falta.
 */
export interface ImageInput {
  url?: string;
  base64?: string;
  mediaType?: string;
}

/**
 * Contexto que se le pasa al proveedor de IA para generar una respuesta.
 * Incluye todo lo que el modelo necesita saber sobre el negocio y la charla.
 */
export interface ConversationContext {
  /** ID del negocio (multi-tenant) al que pertenece esta conversación. */
  businessId: string;
  /** Nombre del cliente, si se conoce (para personalizar la respuesta). */
  clientName?: string;
  /** Historial de mensajes previos de la conversación. */
  history: ConversationTurn[];
  /** Prompt de sistema que define la personalidad y reglas del bot. */
  systemPrompt: string;
  /**
   * Imágenes adjuntas al último mensaje del usuario (superpoder "Oído y vista").
   * Solo los proveedores con soporte de visión (ej: Anthropic) las usan; los
   * demás las ignoran de forma segura.
   */
  images?: ImageInput[];
}

/**
 * Contrato que debe cumplir todo proveedor de IA.
 * Los métodos opcionales (como generateEmbedding) no todos los proveedores
 * los soportan, por eso están marcados con "?".
 */
export interface AIProvider {
  /** Nombre identificador del proveedor (ej: "anthropic", "openai"). */
  name: string;

  /**
   * Genera una respuesta de texto a partir de un prompt y un contexto
   * de conversación (historial + prompt de sistema del negocio).
   */
  generateResponse(prompt: string, context: ConversationContext): Promise<string>;

  /**
   * Genera un vector de embedding para un texto dado.
   * Útil para búsqueda semántica (ej: FAQ, catálogo). Opcional porque
   * no todos los proveedores lo implementan (o no lo necesitamos siempre).
   */
  generateEmbedding?(text: string): Promise<number[]>;
}

/** Config genérica de un proveedor, leída desde variables de entorno. */
export interface AIProviderConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}
