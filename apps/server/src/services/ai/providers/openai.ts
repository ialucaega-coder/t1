/**
 * Proveedor de IA usando ChatGPT (OpenAI).
 *
 * El SDK 'openai' está instalado en el monorepo. Este proveedor soporta el
 * superpoder "Oído y vista" (visión): los modelos gpt-4o / gpt-4o-mini aceptan
 * imágenes por URL o base64 como parte del contenido del mensaje del usuario.
 */
import OpenAI from 'openai';
import type { AIProvider, AIProviderConfig, ConversationContext, ImageInput } from '../provider';

const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_MAX_TOKENS = 1024;

/** Content-type por defecto para imágenes base64 si el caller no lo especifica. */
const DEFAULT_IMAGE_MIME = 'image/jpeg';

/**
 * Arma el contenido del mensaje del usuario para la API de OpenAI. Si no hay
 * imágenes, devuelve el texto plano; si las hay, devuelve el arreglo de partes
 * (texto + image_url), usando data-URL para base64 y la URL directa si vino URL.
 */
function buildUserContent(
  prompt: string,
  images?: ImageInput[],
): string | OpenAI.Chat.Completions.ChatCompletionContentPart[] {
  if (!images || images.length === 0) return prompt;

  const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];
  for (const img of images) {
    if (img.url) {
      parts.push({ type: 'image_url', image_url: { url: img.url } });
    } else if (img.base64) {
      const mime = img.mediaType || DEFAULT_IMAGE_MIME;
      parts.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${img.base64}` } });
    }
  }
  parts.push({ type: 'text', text: prompt });
  return parts;
}

export class OpenAIProvider implements AIProvider {
  name = 'openai';

  private client: OpenAI;
  private model: string;
  private maxTokens: number;
  private temperature: number;

  constructor(config: AIProviderConfig) {
    // baseURL permite apuntar a cualquier API compatible con OpenAI (Groq,
    // DeepSeek, Mistral, Together, Perplexity, Cohere, Gemini, Ollama, LM Studio).
    this.client = new OpenAI({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    });
    this.model = config.model || DEFAULT_MODEL;
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.temperature = config.temperature ?? 0.7;
  }

  /**
   * Genera una respuesta usando la API de Chat Completions de OpenAI.
   * El prompt de sistema se manda como primer mensaje con role "system".
   * Si el contexto trae imágenes (superpoder "Oído y vista"), se adjuntan al
   * mensaje del usuario como partes multimodales (requiere un modelo con visión,
   * ej: gpt-4o / gpt-4o-mini).
   */
  async generateResponse(prompt: string, context: ConversationContext): Promise<string> {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: context.systemPrompt },
      ...context.history.map((turn) => ({ role: turn.role, content: turn.content })),
      { role: 'user', content: buildUserContent(prompt, context.images) },
    ];

    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      messages,
    });

    return response.choices[0]?.message?.content ?? '';
  }

  /** Genera un embedding usando el modelo text-embedding-3-small de OpenAI. */
  async generateEmbedding(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    return response.data[0]?.embedding ?? [];
  }
}
