/**
 * Proveedor de IA usando Claude (Anthropic).
 *
 * Usa el SDK '@anthropic-ai/sdk' (declarado en package.json). Soporta el
 * superpoder "Oído y vista" en su parte de VISIÓN: si el contexto trae
 * imágenes (por URL http/https o base64), se agregan como bloques de tipo
 * "image" al contenido del mensaje del usuario para que el modelo las analice.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { AIProvider, AIProviderConfig, ConversationContext, ImageInput } from '../provider';

const DEFAULT_MODEL = 'claude-sonnet-4-5';
const DEFAULT_MAX_TOKENS = 1024;

export class AnthropicProvider implements AIProvider {
  name = 'anthropic';

  private client: Anthropic;
  private model: string;
  private maxTokens: number;
  private temperature: number;

  constructor(config: AIProviderConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.model = config.model || DEFAULT_MODEL;
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.temperature = config.temperature ?? 0.7;
  }

  /**
   * Genera una respuesta usando la API de Mensajes de Anthropic.
   * El prompt de sistema y el historial vienen del contexto de la conversación.
   */
  async generateResponse(prompt: string, context: ConversationContext): Promise<string> {
    const userContent = this.buildUserContent(prompt, context.images);

    const messages = [
      ...context.history.map((turn) => ({ role: turn.role, content: turn.content })),
      { role: 'user' as const, content: userContent },
    ];

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      system: context.systemPrompt,
      messages,
    });

    // El primer bloque de contenido de tipo "text" es la respuesta principal.
    const textBlock = response.content.find(
      (block: { type: string }) => block.type === 'text'
    ) as { type: string; text?: string } | undefined;
    return textBlock?.text ?? '';
  }

  /**
   * Arma el contenido del mensaje del usuario. Si no hay imágenes, devuelve
   * el texto plano (comportamiento original). Si hay imágenes válidas, arma
   * un arreglo de bloques: primero cada imagen (URL o base64) y luego el texto.
   * Las imágenes sin URL ni base64 se descartan silenciosamente.
   */
  private buildUserContent(
    prompt: string,
    images?: ImageInput[],
  ): string | Anthropic.ContentBlockParam[] {
    if (!images || images.length === 0) return prompt;

    const imageBlocks: Anthropic.ImageBlockParam[] = [];
    for (const img of images) {
      if (img.url) {
        imageBlocks.push({ type: 'image', source: { type: 'url', url: img.url } });
      } else if (img.base64) {
        imageBlocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: (img.mediaType as Anthropic.Base64ImageSource['media_type']) || 'image/jpeg',
            data: img.base64,
          },
        });
      }
    }

    if (imageBlocks.length === 0) return prompt;

    return [...imageBlocks, { type: 'text', text: prompt }];
  }

  // Anthropic no ofrece un endpoint de embeddings propio (se usaría un
  // proveedor externo como Voyage AI), por eso no implementamos este método.
}
