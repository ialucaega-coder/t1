/**
 * Proveedor de IA usando ChatGPT (OpenAI).
 *
 * NOTA: este archivo importa el SDK 'openai', que todavía NO está instalado
 * en package.json. Hay que agregarlo con:
 *   npm install openai --workspace=apps/server
 * hasta entonces, `tsc --noEmit` va a fallar al no encontrar el módulo.
 */
import OpenAI from 'openai';
import type { AIProvider, AIProviderConfig, ConversationContext } from '../provider';

const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_MAX_TOKENS = 1024;

export class OpenAIProvider implements AIProvider {
  name = 'openai';

  private client: OpenAI;
  private model: string;
  private maxTokens: number;
  private temperature: number;

  constructor(config: AIProviderConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey });
    this.model = config.model || DEFAULT_MODEL;
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.temperature = config.temperature ?? 0.7;
  }

  /**
   * Genera una respuesta usando la API de Chat Completions de OpenAI.
   * El prompt de sistema se manda como primer mensaje con role "system".
   */
  async generateResponse(prompt: string, context: ConversationContext): Promise<string> {
    const messages = [
      { role: 'system' as const, content: context.systemPrompt },
      ...context.history.map((turn) => ({ role: turn.role, content: turn.content })),
      { role: 'user' as const, content: prompt },
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
