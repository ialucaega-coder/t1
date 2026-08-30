/**
 * Proveedor de IA usando Claude (Anthropic).
 *
 * NOTA: este archivo importa el SDK '@anthropic-ai/sdk', que todavía NO está
 * instalado en package.json. Hay que agregarlo con:
 *   npm install @anthropic-ai/sdk --workspace=apps/server
 * hasta entonces, `tsc --noEmit` va a fallar al no encontrar el módulo.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { AIProvider, AIProviderConfig, ConversationContext } from '../provider';

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
    const messages = [
      ...context.history.map((turn) => ({ role: turn.role, content: turn.content })),
      { role: 'user' as const, content: prompt },
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

  // Anthropic no ofrece un endpoint de embeddings propio (se usaría un
  // proveedor externo como Voyage AI), por eso no implementamos este método.
}
