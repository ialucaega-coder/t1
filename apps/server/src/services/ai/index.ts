/**
 * Punto de entrada del módulo de IA.
 * Re-exporta todo lo necesario para que el resto del backend importe
 * desde un único lugar: `services/ai`.
 */
export type { AIProvider, AIProviderConfig, ConversationContext, ConversationTurn } from './provider';
export { AnthropicProvider } from './providers/anthropic';
export { OpenAIProvider } from './providers/openai';
export {
  createAIProvider,
  getDefaultAIProvider,
  isProviderConfigured,
  listAvailableProviders,
} from './factory';
export type { SupportedProviderName } from './factory';
