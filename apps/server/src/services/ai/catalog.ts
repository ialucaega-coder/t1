/**
 * Catálogo de "Motores de IA" disponibles para los bots.
 *
 * Cada negocio puede elegir con qué modelo/proveedor responde su bot y cargar
 * su propia API key por proveedor. La mayoría de estos proveedores exponen un
 * endpoint COMPATIBLE con OpenAI, así que se instancian con el SDK de OpenAI
 * apuntando a su `baseURL` (kind 'openai-compatible'). Claude usa su SDK nativo.
 *
 * Nada de esto toca el schema: la selección y las keys se guardan en una
 * `Connection` (type 'AI_ENGINE') con la config en JSON. Ver services/ai/engine.ts.
 */

/** Cómo se instancia el proveedor detrás de un motor. */
export type EngineKind = 'anthropic' | 'openai-compatible';

/** Familia de proveedor: agrupa motores que comparten la misma API key. */
export type ProviderFamily =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'groq'
  | 'deepseek'
  | 'mistral'
  | 'together'
  | 'perplexity'
  | 'cohere'
  | 'ollama'
  | 'lmstudio';

export interface AIEngine {
  /** Id estable del motor (se guarda como activeEngineId). */
  id: string;
  /** Nombre visible en el panel. */
  name: string;
  /** Familia de proveedor (agrupa la API key). */
  provider: ProviderFamily;
  /** Modelo concreto que se le pide a la API. */
  model?: string;
  /** 'api' (nube, requiere key) o 'local' (Ollama/LM Studio, sin key). */
  type: 'api' | 'local';
  /** Si el motor soporta visión (imágenes) para "Oído y vista". */
  vision: boolean;
  /** Cómo instanciarlo. */
  kind: EngineKind;
  /** URL base para APIs compatibles con OpenAI. */
  baseURL?: string;
  /** Variable de entorno con la key global de fallback (si existe). */
  keyEnv?: string;
  /** Los motores locales no necesitan key. */
  keyless?: boolean;
  /** Icono sugerido para el panel. */
  icon?: string;
}

export const AI_ENGINES: AIEngine[] = [
  // ── Google Gemini (endpoint compatible con OpenAI) ─────────────────────
  {
    id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'gemini', model: 'gemini-2.0-flash',
    type: 'api', vision: true, kind: 'openai-compatible',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/', keyEnv: 'GEMINI_API_KEY', icon: 'Sparkles',
  },
  {
    id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', provider: 'gemini', model: 'gemini-1.5-flash',
    type: 'api', vision: true, kind: 'openai-compatible',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/', keyEnv: 'GEMINI_API_KEY', icon: 'Sparkles',
  },
  {
    id: 'gemini-vision', name: 'Gemini Vision (Fotos)', provider: 'gemini', model: 'gemini-1.5-flash',
    type: 'api', vision: true, kind: 'openai-compatible',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/', keyEnv: 'GEMINI_API_KEY', icon: 'Eye',
  },
  // ── Anthropic Claude (SDK nativo) ──────────────────────────────────────
  {
    id: 'claude-sonnet', name: 'Claude Sonnet', provider: 'anthropic',
    type: 'api', vision: true, kind: 'anthropic', keyEnv: 'ANTHROPIC_API_KEY', icon: 'Bot',
  },
  // ── OpenAI ─────────────────────────────────────────────────────────────
  {
    id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', model: 'gpt-4o',
    type: 'api', vision: true, kind: 'openai-compatible', keyEnv: 'OPENAI_API_KEY', icon: 'Zap',
  },
  {
    id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', model: 'gpt-4o-mini',
    type: 'api', vision: true, kind: 'openai-compatible', keyEnv: 'OPENAI_API_KEY', icon: 'Zap',
  },
  // ── Groq / DeepSeek / Mistral / Together / Perplexity / Cohere ─────────
  {
    id: 'groq-llama-3.3-70b', name: 'Groq Llama 3.3 70B', provider: 'groq', model: 'llama-3.3-70b-versatile',
    type: 'api', vision: false, kind: 'openai-compatible',
    baseURL: 'https://api.groq.com/openai/v1', keyEnv: 'GROQ_API_KEY', icon: 'Rocket',
  },
  {
    id: 'deepseek-v3', name: 'DeepSeek V3', provider: 'deepseek', model: 'deepseek-chat',
    type: 'api', vision: false, kind: 'openai-compatible',
    baseURL: 'https://api.deepseek.com', keyEnv: 'DEEPSEEK_API_KEY', icon: 'Brain',
  },
  {
    id: 'mistral-large', name: 'Mistral Large', provider: 'mistral', model: 'mistral-large-latest',
    type: 'api', vision: false, kind: 'openai-compatible',
    baseURL: 'https://api.mistral.ai/v1', keyEnv: 'MISTRAL_API_KEY', icon: 'Wind',
  },
  {
    id: 'together-llama-3.1', name: 'Together Llama 3.1', provider: 'together',
    model: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
    type: 'api', vision: false, kind: 'openai-compatible',
    baseURL: 'https://api.together.xyz/v1', keyEnv: 'TOGETHER_API_KEY', icon: 'Users',
  },
  {
    id: 'perplexity-sonar', name: 'Perplexity Sonar', provider: 'perplexity', model: 'sonar',
    type: 'api', vision: false, kind: 'openai-compatible',
    baseURL: 'https://api.perplexity.ai', keyEnv: 'PERPLEXITY_API_KEY', icon: 'Compass',
  },
  {
    id: 'cohere-command-r-plus', name: 'Cohere Command R+', provider: 'cohere', model: 'command-r-plus',
    type: 'api', vision: false, kind: 'openai-compatible',
    baseURL: 'https://api.cohere.ai/compatibility/v1', keyEnv: 'COHERE_API_KEY', icon: 'MessageSquare',
  },
  // ── Locales (sin key) ──────────────────────────────────────────────────
  {
    id: 'ollama-local', name: 'Ollama Local', provider: 'ollama', model: 'llama3.1',
    type: 'local', vision: false, kind: 'openai-compatible',
    baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1', keyless: true, icon: 'Server',
  },
  {
    id: 'lmstudio-local', name: 'LM Studio Local', provider: 'lmstudio', model: 'local-model',
    type: 'local', vision: false, kind: 'openai-compatible',
    baseURL: process.env.LMSTUDIO_BASE_URL || 'http://localhost:1234/v1', keyless: true, icon: 'Server',
  },
];

/** Motor por defecto si el negocio no eligió ninguno. */
export const DEFAULT_ENGINE_ID = 'claude-sonnet';

/** Busca un motor por id. */
export function getEngineById(id: string): AIEngine | undefined {
  return AI_ENGINES.find((e) => e.id === id);
}
