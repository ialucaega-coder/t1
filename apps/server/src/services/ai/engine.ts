/**
 * Selección de "Motor de IA" por negocio y resolución del proveedor.
 *
 * Persistencia sin schema: una `Connection` (type 'AI_ENGINE') por negocio guarda
 * en `config` el motor activo y las API keys por familia de proveedor:
 *   { activeEngineId: string, keys: { [ProviderFamily]: string } }
 *
 * `getAIProviderForBusiness` arma el AIProvider correcto según el motor elegido:
 * usa la key propia del negocio; si no tiene, cae al "relay" (key global del
 * entorno de la plataforma); si tampoco hay y no es local, cae al proveedor por
 * defecto para que el bot siga respondiendo.
 */
import type { AIProvider } from './provider';
import { AnthropicProvider } from './providers/anthropic';
import { OpenAIProvider } from './providers/openai';
import { getDefaultAIProvider } from './factory';
import { AI_ENGINES, DEFAULT_ENGINE_ID, getEngineById, type AIEngine, type ProviderFamily } from './catalog';
import { prisma } from '../../lib/prisma';
import { Prisma } from '@prisma/client';

const CONNECTION_TYPE = 'AI_ENGINE';

export interface EngineConfig {
  activeEngineId: string;
  keys: Partial<Record<ProviderFamily, string>>;
}

/** Estado de un motor para el panel (nunca expone el valor de la key). */
export interface EngineStatus extends Omit<AIEngine, 'baseURL' | 'keyEnv' | 'keyless'> {
  active: boolean;
  /** El negocio cargó su propia key para este proveedor. */
  hasOwnKey: boolean;
  /** La plataforma tiene key global => puede funcionar por "relay". */
  relayAvailable: boolean;
  /** Local: no necesita key. */
  local: boolean;
  /** ¿Se puede usar ya? (key propia, relay o local). */
  ready: boolean;
}

// Caché de providers por negocio+motor. Se invalida explícitamente al cambiar la
// config, y además tiene un TTL corto: en despliegues multi-instancia la
// invalidación explícita solo alcanza al proceso que hizo el cambio, así que el
// TTL garantiza que una key rotada/revocada deje de usarse pronto sin reiniciar.
const PROVIDER_CACHE_TTL_MS = 5 * 60 * 1000;
const providerCache = new Map<string, { provider: AIProvider; expiresAt: number }>();

function cacheKeyFor(businessId: string, engineId: string): string {
  return `${businessId}:${engineId}`;
}

function invalidateBusiness(businessId: string): void {
  for (const key of providerCache.keys()) {
    if (key.startsWith(`${businessId}:`)) providerCache.delete(key);
  }
}

/** Lee la config de motor del negocio (con defaults seguros). */
export async function loadEngineConfig(businessId: string): Promise<EngineConfig> {
  const conn = await prisma.connection.findFirst({
    where: { businessId, type: CONNECTION_TYPE },
    select: { config: true },
    // Orden determinista: si por una carrera existieran filas duplicadas para el
    // mismo negocio (no hay unique constraint a nivel DB por ser JSON), siempre
    // gana la misma. Lo ideal sería @@unique([businessId, type]) en el schema.
    orderBy: { id: 'asc' },
  });
  const cfg = (conn?.config as Partial<EngineConfig> | null) || {};
  return {
    activeEngineId: typeof cfg.activeEngineId === 'string' ? cfg.activeEngineId : DEFAULT_ENGINE_ID,
    keys: (cfg.keys && typeof cfg.keys === 'object' ? cfg.keys : {}) as EngineConfig['keys'],
  };
}

/** Upsert de la Connection AI_ENGINE conservando el resto de la config. */
async function upsertConfig(businessId: string, mutate: (cfg: EngineConfig) => EngineConfig): Promise<EngineConfig> {
  const existing = await prisma.connection.findFirst({
    where: { businessId, type: CONNECTION_TYPE },
    orderBy: { id: 'asc' },
  });
  const current = await loadEngineConfig(businessId);
  const next = mutate(current);

  const configJson = next as unknown as Prisma.InputJsonObject;
  if (existing) {
    await prisma.connection.update({ where: { id: existing.id }, data: { config: configJson, isActive: true } });
  } else {
    await prisma.connection.create({
      data: { name: 'Motor de IA', type: CONNECTION_TYPE, icon: 'Cpu', config: configJson, isActive: true, businessId },
    });
  }
  invalidateBusiness(businessId);
  return next;
}

/** Cambia el motor activo del negocio. Valida que el id exista en el catálogo. */
export async function setActiveEngine(businessId: string, engineId: string): Promise<EngineConfig> {
  if (!getEngineById(engineId)) {
    throw new Error(`Motor de IA desconocido: ${engineId}`);
  }
  return upsertConfig(businessId, (cfg) => ({ ...cfg, activeEngineId: engineId }));
}

/** Guarda (o borra, con apiKey vacía) la API key propia de una familia. */
export async function setEngineKey(businessId: string, provider: ProviderFamily, apiKey: string): Promise<EngineConfig> {
  return upsertConfig(businessId, (cfg) => {
    const keys = { ...cfg.keys };
    if (apiKey && apiKey.trim()) keys[provider] = apiKey.trim();
    else delete keys[provider];
    return { ...cfg, keys };
  });
}

/** Resuelve la key efectiva para un motor: propia > relay (env) > local. */
function resolveKey(engine: AIEngine, cfg: EngineConfig): string | null {
  const own = cfg.keys[engine.provider];
  if (own) return own;
  if (engine.keyEnv && process.env[engine.keyEnv]) return process.env[engine.keyEnv] as string;
  if (engine.keyless) return 'local'; // Ollama/LM Studio ignoran la key
  return null;
}

/**
 * Devuelve el AIProvider a usar para un negocio, según su motor activo.
 * Si el motor elegido no tiene key usable, cae al proveedor por defecto de la
 * plataforma para no dejar al bot sin responder.
 */
export async function getAIProviderForBusiness(businessId: string): Promise<AIProvider> {
  const cfg = await loadEngineConfig(businessId);
  const engine = getEngineById(cfg.activeEngineId);
  if (!engine) return safeDefaultProvider();

  const now = Date.now();
  const cached = providerCache.get(cacheKeyFor(businessId, engine.id));
  if (cached && cached.expiresAt > now) return cached.provider;

  const key = resolveKey(engine, cfg);
  // Sin key propia, relay ni local: caemos al proveedor por defecto de la
  // plataforma (si tampoco hay, safeDefaultProvider lanza un error de dominio
  // claro que processMessage captura para degradar con un mensaje amable).
  if (!key) return safeDefaultProvider();

  let provider: AIProvider;
  if (engine.kind === 'anthropic') {
    provider = new AnthropicProvider({ apiKey: key, model: engine.model });
  } else {
    provider = new OpenAIProvider({ apiKey: key, baseURL: engine.baseURL, model: engine.model });
  }

  providerCache.set(cacheKeyFor(businessId, engine.id), { provider, expiresAt: now + PROVIDER_CACHE_TTL_MS });
  return provider;
}

/**
 * Envuelve getDefaultAIProvider para no dejar escapar un throw inesperado del
 * factory: si no hay ningún proveedor global configurado, lanza un error de
 * dominio claro (el caller ya lo captura y responde con un mensaje amable).
 */
function safeDefaultProvider(): AIProvider {
  try {
    return getDefaultAIProvider();
  } catch {
    throw new Error('No hay un motor de IA disponible (sin key propia, relay ni proveedor por defecto).');
  }
}

/** Arma el estado del catálogo para el panel del negocio (sin exponer keys). */
export async function listEnginesForBusiness(businessId: string): Promise<{ activeEngineId: string; engines: EngineStatus[] }> {
  const cfg = await loadEngineConfig(businessId);
  const engines = AI_ENGINES.map((e): EngineStatus => {
    const hasOwnKey = Boolean(cfg.keys[e.provider]);
    const relayAvailable = Boolean(e.keyEnv && process.env[e.keyEnv]);
    const local = Boolean(e.keyless);
    // Exponemos solo campos seguros (sin baseURL/keyEnv/keyless internos).
    const { baseURL: _b, keyEnv: _k, keyless: _l, ...safe } = e;
    return {
      ...safe,
      active: cfg.activeEngineId === e.id,
      hasOwnKey,
      relayAvailable,
      local,
      ready: hasOwnKey || relayAvailable || local,
    };
  });
  return { activeEngineId: cfg.activeEngineId, engines };
}
