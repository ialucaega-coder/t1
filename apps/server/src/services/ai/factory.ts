/**
 * Fábrica de proveedores de IA.
 *
 * Centraliza la lógica de "qué proveedor usar" según la configuración
 * del entorno (variables de entorno) o del negocio. Así el resto del
 * sistema (chatbot.ts, rutas) no necesita saber qué SDK hay detrás:
 * solo pide un AIProvider y lo usa.
 */
import type { AIProvider, AIProviderConfig } from './provider';
import { AnthropicProvider } from './providers/anthropic';
import { OpenAIProvider } from './providers/openai';

export type SupportedProviderName = 'anthropic' | 'openai';

/** Nombres de variables de entorno esperadas por cada proveedor. */
const ENV_KEYS: Record<SupportedProviderName, { apiKey: string; model: string }> = {
  anthropic: { apiKey: 'ANTHROPIC_API_KEY', model: 'ANTHROPIC_MODEL' },
  openai: { apiKey: 'OPENAI_API_KEY', model: 'OPENAI_MODEL' },
};

// Caché simple en memoria: evita instanciar un cliente nuevo en cada request.
const providerCache = new Map<string, AIProvider>();

/**
 * Devuelve true si el proveedor tiene una API key configurada en el entorno.
 * Se usa para armar la lista de "proveedores disponibles" en la ruta GET /providers.
 */
export function isProviderConfigured(providerName: SupportedProviderName): boolean {
  const envKey = ENV_KEYS[providerName].apiKey;
  return Boolean(process.env[envKey]);
}

/** Lista todos los proveedores soportados y si están configurados o no. */
export function listAvailableProviders(): { name: SupportedProviderName; configured: boolean }[] {
  return (Object.keys(ENV_KEYS) as SupportedProviderName[]).map((name) => ({
    name,
    configured: isProviderConfigured(name),
  }));
}

/**
 * Crea (o reutiliza) una instancia del proveedor pedido, leyendo la API key
 * y el modelo desde las variables de entorno correspondientes.
 *
 * Lanza un error claro si falta la API key, en vez de fallar silenciosamente
 * más adelante contra la API externa.
 */
export function createAIProvider(providerName: SupportedProviderName, overrides?: Partial<AIProviderConfig>): AIProvider {
  const cacheKey = `${providerName}:${overrides?.model ?? 'default'}`;
  const cached = providerCache.get(cacheKey);
  if (cached) return cached;

  const envKeys = ENV_KEYS[providerName];
  const apiKey = overrides?.apiKey || process.env[envKeys.apiKey];
  if (!apiKey) {
    throw new Error(`Falta configurar ${envKeys.apiKey} para usar el proveedor "${providerName}"`);
  }

  const config: AIProviderConfig = {
    apiKey,
    model: overrides?.model || process.env[envKeys.model],
    maxTokens: overrides?.maxTokens,
    temperature: overrides?.temperature,
  };

  let provider: AIProvider;
  switch (providerName) {
    case 'anthropic':
      provider = new AnthropicProvider(config);
      break;
    case 'openai':
      provider = new OpenAIProvider(config);
      break;
    default:
      throw new Error(`Proveedor de IA no soportado: ${providerName}`);
  }

  providerCache.set(cacheKey, provider);
  return provider;
}

/**
 * Devuelve el proveedor "por defecto" del sistema: usa AI_PROVIDER del
 * entorno si está seteado, o el primer proveedor configurado que encuentre.
 */
export function getDefaultAIProvider(): AIProvider {
  const preferred = process.env.AI_PROVIDER as SupportedProviderName | undefined;
  if (preferred && ENV_KEYS[preferred]) {
    return createAIProvider(preferred);
  }

  const available = listAvailableProviders().find((p) => p.configured);
  if (!available) {
    throw new Error('No hay ningún proveedor de IA configurado (falta ANTHROPIC_API_KEY u OPENAI_API_KEY)');
  }
  return createAIProvider(available.name);
}
