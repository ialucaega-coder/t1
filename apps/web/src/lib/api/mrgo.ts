import { httpClient } from './http-client';
import type { MrGoColorKey, MrGoEmotion } from '@/components/mrgo/types';

/**
 * Cliente API de Mr Go — el avatar/orquestador "CEO" que delega en agentes-rol.
 *
 * Reusa el `httpClient` como el resto de módulos (ver workflows.ts / clients.ts).
 * Los tipos de acá espejan el contrato del backend (apps/server/src/services/mrgo):
 * - `/agents` devuelve la config resuelta de agentes + catálogos de roles y tools.
 * - `/orchestrate` devuelve SOLO la decisión de routing (no ejecuta el tool en v1).
 */

/**
 * Config resuelta de UN agente del negocio. Es lo que devuelve el backend en
 * `agents` (no trae nombre/color/descripción: esos están en `roles`).
 */
export interface MrGoAgentConfig {
  key: string;
  activo: boolean;
  /** Familia de proveedor de IA opcional para este agente (ej: 'anthropic'). */
  llmProvider?: string;
  /** Modelo de IA opcional para este agente (ej: 'claude-3-5-sonnet'). */
  llmModel?: string;
}

/**
 * Un rol del catálogo (datos de presentación para pintar la tarjeta). El `color`
 * que manda el backend es un hex de marca; para el avatar Mr Go usamos el mapa
 * `AGENT_COLOR_KEYS` de abajo (clave de agente → MrGoColorKey).
 */
export interface MrGoRole {
  key: string;
  nombre: string;
  color: string;
  descripcion: string;
}

/** Un tool que un agente podría proponer (mapea a un endpoint ya existente). */
export interface MrGoTool {
  key: string;
  nombre: string;
  descripcion: string;
  endpoint: string;
}

/** Respuesta de GET /agents: config del negocio + catálogos de roles y tools. */
export interface MrGoAgentsResponse {
  agents: MrGoAgentConfig[];
  roles: MrGoRole[];
  tools: MrGoTool[];
}

/**
 * Decisión de routing que devuelve POST /orchestrate. `emotion` viene como texto
 * libre del LLM (ej: 'neutral', 'entusiasmo'); el front lo mapea a MrGoEmotion.
 * `tool`/`toolParams` son opcionales (solo si Mr Go propuso una acción).
 */
export interface OrchestratorDecision {
  nextAgent: string;
  emotion: string;
  reasoning: string;
  tool?: string;
  toolParams?: Record<string, unknown>;
}

/**
 * Mapa clave-de-agente → color de la familia Mr Go (para el avatar). El backend
 * manda un hex en `roles[].color`, pero MrGoAvatar necesita una MrGoColorKey. El
 * CEO es LILA (insignia). Las claves que no estén acá caen a LILA por defecto.
 */
export const AGENT_COLOR_KEYS: Record<string, MrGoColorKey> = {
  ceo: 'LILA',
  marketing: 'PINK',
  ventas: 'ORANGE',
  finanzas: 'GREEN',
  reservas: 'LIGHT_BLUE',
  cobros: 'YELLOW',
  soporte: 'RED',
  inbox: 'BLUE',
  crm: 'TURQUOISE',
  catalogo: 'LIME',
  campanas: 'BEIGE',
  analitica: 'BLACK',
  rrhh: 'BROWN',
  operaciones: 'WHITE',
};

/** Clave del CEO/Mr Go (el agente destacado y fallback del orquestador). */
export const CEO_AGENT_KEY = 'ceo';

/** Devuelve la MrGoColorKey de un agente (LILA por defecto si no está mapeado). */
export function colorKeyForAgent(key: string): MrGoColorKey {
  return AGENT_COLOR_KEYS[key] ?? 'LILA';
}

/**
 * Traduce la emoción de texto libre del orquestador a una MrGoEmotion válida
 * para el avatar. Defensivo: cualquier valor desconocido cae a 'thinking'.
 */
export function mapEmotion(raw: string | undefined | null): MrGoEmotion {
  const v = (raw ?? '').trim().toLowerCase();
  if (['happy', 'feliz', 'contento', 'alegre', 'entusiasmo', 'entusiasmado'].includes(v)) return 'happy';
  if (['working', 'trabajando', 'ocupado', 'activo'].includes(v)) return 'working';
  if (['thinking', 'pensando', 'neutral', 'analizando', 'duda'].includes(v)) return 'thinking';
  if (['nerd', 'tecnico', 'técnico'].includes(v)) return 'nerd';
  if (['angry', 'enojado', 'molesto', 'serio'].includes(v)) return 'angry';
  if (['sleepy', 'dormido', 'cansado', 'inactivo'].includes(v)) return 'sleepy';
  if (['love', 'amor', 'enamorado', 'encantado'].includes(v)) return 'love';
  return 'thinking';
}

/** Lista la config de agentes del negocio + catálogos de roles y tools. */
export function getMrGoAgents() {
  return httpClient.get<MrGoAgentsResponse>('/mrgo/agents');
}

/** Le da una orden al equipo: el orquestador decide qué agente la atiende. */
export function orchestrate(text: string, channel?: string) {
  return httpClient.post<OrchestratorDecision>('/mrgo/orchestrate', { text, channel });
}

/** Persiste qué agentes están activos (y su motor de IA opcional). */
export function saveMrGoAgents(agents: MrGoAgentConfig[]) {
  return httpClient.put<{ agents: MrGoAgentConfig[] }>('/mrgo/agents', { agents });
}
