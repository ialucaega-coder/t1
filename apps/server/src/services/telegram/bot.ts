import { Api, Bot } from 'grammy';
import { registerHandlers } from './handlers';
import { safeDecrypt } from '../../lib/crypto';
import { sharedTryLock } from '../../lib/sharedState';

// ────────────────────────────────────────────────────────────────
// Gestión de instancias de bots de Telegram.
//
// Cada negocio puede tener su propio bot conectado. Las instancias de `Bot` son
// una CACHÉ por proceso (businessId → Bot + token con el que se armó), no la
// fuente de verdad: esa es la `Connection` en la DB. Así, con varias réplicas, el
// webhook puede caer en cualquiera: si esa instancia no tiene el bot (o lo tiene
// armado con un token viejo porque se rotó en otra), lo arma al vuelo con el token
// que ya cargó la ruta. Acotada con LRU para no crecer con la cantidad de tenants.
// ────────────────────────────────────────────────────────────────

interface ActiveBot {
  bot: Bot;
  token: string;
}

/** Máximo de bots en memoria por proceso; al pasarse se descarta el menos usado. */
const MAX_ACTIVE_BOTS = 500;

const activeBots = new Map<string, ActiveBot>();
/** Armados en curso (dedupe: varios updates simultáneos no hacen varios `init`). */
const building = new Map<string, Promise<Bot>>();

/** Guarda/renueva la entrada como "más reciente" y desaloja las más viejas. */
function remember(businessId: string, entry: ActiveBot): void {
  activeBots.delete(businessId);
  activeBots.set(businessId, entry);
  while (activeBots.size > MAX_ACTIVE_BOTS) {
    const oldest = activeBots.keys().next().value;
    if (oldest === undefined) break;
    activeBots.delete(oldest);
  }
}

/**
 * Devuelve el bot del negocio para ese token, armándolo si hace falta (primer
 * update en esta instancia, o token rotado desde otra). No toca el webhook de
 * Telegram: solo prepara la instancia local para procesar updates.
 */
async function ensureBot(businessId: string, token: string): Promise<Bot> {
  const hit = activeBots.get(businessId);
  if (hit && hit.token === token) {
    remember(businessId, hit); // LRU: lo marcamos como recién usado
    return hit.bot;
  }

  const inFlight = building.get(businessId);
  if (inFlight) return inFlight;

  const promise = (async () => {
    const bot = new Bot(token);
    registerHandlers(bot, businessId);
    await bot.init(); // valida el token con Telegram (1 llamada por bot y proceso)
    remember(businessId, { bot, token });
    return bot;
  })();
  building.set(businessId, promise);
  try {
    return await promise;
  } finally {
    building.delete(businessId);
  }
}

/**
 * Crea e inicializa un bot de Telegram para un negocio.
 * Registra los handlers y devuelve la instancia lista para
 * procesar updates (vía webhook).
 */
export async function createBot(token: string, businessId: string): Promise<Bot> {
  // Si ya existe un bot para este negocio, detenerlo primero
  await stopBot(businessId);

  const bot = new Bot(token);

  // Registrar todos los handlers de comandos y callbacks
  registerHandlers(bot, businessId);

  // Inicializar el bot (valida el token con Telegram)
  await bot.init();

  remember(businessId, { bot, token });

  console.log(`Bot de Telegram iniciado para negocio ${businessId}: @${bot.botInfo.username}`);
  return bot;
}

/**
 * Obtiene el bot activo para un negocio.
 */
export function getBot(businessId: string): Bot | undefined {
  return activeBots.get(businessId)?.bot;
}

/**
 * Detiene y elimina el bot de un negocio y borra su webhook en Telegram.
 * Si esta instancia no tiene el bot en memoria (el webhook lo atendía otra),
 * pasá `token` para poder borrar igual el webhook de Telegram.
 */
export async function stopBot(businessId: string, token?: string): Promise<void> {
  const entry = activeBots.get(businessId);
  if (entry || token) {
    try {
      // Eliminar webhook en Telegram
      await (entry ? entry.bot.api : new Api(token!)).deleteWebhook();
    } catch (error) {
      console.warn(`Error al eliminar webhook del bot (negocio ${businessId}):`, error);
    }
  }
  if (entry) {
    activeBots.delete(businessId);
    console.log(`Bot de Telegram detenido para negocio ${businessId}`);
  }
}

/**
 * Configura el webhook del bot en Telegram.
 * @param webhookUrl URL pública donde Telegram enviará los updates.
 */
export async function setWebhook(businessId: string, webhookUrl: string, secretToken?: string): Promise<void> {
  const bot = activeBots.get(businessId)?.bot;
  if (!bot) {
    throw new Error(`No hay bot activo para el negocio ${businessId}`);
  }

  // secret_token: Telegram lo reenvía en el header X-Telegram-Bot-Api-Secret-Token
  // en cada update, así autenticamos el webhook SIN poner el botToken en la URL.
  await bot.api.setWebhook(webhookUrl, secretToken ? { secret_token: secretToken } : undefined);
  console.log(`Webhook configurado para negocio ${businessId}`);
}

/**
 * Procesa un update entrante de Telegram para un negocio.
 * `token` es el del bot (ya descifrado por la ruta del webhook): con él esta
 * instancia arma el bot al vuelo si no lo tiene. Sin `token` solo se usa un bot
 * ya presente en memoria.
 */
export async function handleUpdate(businessId: string, update: unknown, token?: string): Promise<void> {
  const bot = token ? await ensureBot(businessId, token) : activeBots.get(businessId)?.bot;
  if (!bot) {
    console.warn(`Update recibido para negocio sin bot activo: ${businessId}`);
    return;
  }

  // grammy espera el objeto update de Telegram tal cual
  await bot.handleUpdate(update as Parameters<Bot['handleUpdate']>[0]);
}

/**
 * Obtiene información del bot (username, nombre, etc.)
 */
export function getBotInfo(businessId: string) {
  const bot = activeBots.get(businessId)?.bot;
  if (!bot) return null;
  return bot.botInfo;
}

/** Tamaño de lote al re-registrar webhooks al arrancar (no saturar la API de Telegram). */
const RESTORE_CONCURRENCY = 5;

/**
 * Al iniciar el servidor, vuelve a registrar el webhook de cada conexión activa
 * (self-heal si cambió la URL pública). Ya NO arma un `Bot` por tenant ni lo
 * mantiene en memoria: los bots se arman on-demand con el primer update (ver
 * `ensureBot`). Y con varias réplicas solo UNA lo hace (lock en Redis): antes cada
 * instancia repetía el `setWebhook` de todos los tenants en cada arranque.
 */
export async function restoreActiveBots(): Promise<void> {
  if (!(await sharedTryLock('telegram-restore-webhooks', 10 * 60 * 1000))) {
    console.log('[telegram] otra instancia ya está re-registrando los webhooks, se omite');
    return;
  }

  // Importación dinámica para evitar circularidad
  const { prisma } = await import('../../lib/prisma');

  const connections = await prisma.connection.findMany({
    where: { type: 'TELEGRAM', isActive: true },
    orderBy: { id: 'asc' },
  });

  const restoreOne = async (conn: (typeof connections)[number]) => {
    const config = conn.config as { botToken?: string; botTokenEnc?: string; webhookUrl?: string; webhookSecret?: string } | null;
    // botTokenEnc (cifrado, esquema nuevo) o botToken (legado en claro).
    let token: string | undefined;
    try {
      token = config?.botTokenEnc ? safeDecrypt(config.botTokenEnc) : config?.botToken;
    } catch {
      token = undefined;
    }
    if (!token || !config?.webhookUrl) return;

    try {
      await new Api(token).setWebhook(
        config.webhookUrl,
        config.webhookSecret ? { secret_token: config.webhookSecret } : undefined,
      );
      console.log(`Webhook de Telegram restaurado para negocio ${conn.businessId}`);
    } catch (error) {
      console.error(`Error al restaurar el webhook de Telegram del negocio ${conn.businessId}:`, error);
    }
  };

  for (let i = 0; i < connections.length; i += RESTORE_CONCURRENCY) {
    await Promise.all(connections.slice(i, i + RESTORE_CONCURRENCY).map(restoreOne));
  }
}
