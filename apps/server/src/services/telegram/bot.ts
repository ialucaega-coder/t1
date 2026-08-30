import { Bot } from 'grammy';
import { registerHandlers } from './handlers';

// ────────────────────────────────────────────────────────────────
// Gestión de instancias de bots de Telegram.
//
// Cada negocio puede tener su propio bot conectado. Mantenemos un
// mapa en memoria de bots activos indexados por businessId.
// ────────────────────────────────────────────────────────────────

// Mapa de bots activos: businessId → instancia de Bot
const activeBots = new Map<string, Bot>();

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

  activeBots.set(businessId, bot);

  console.log(`Bot de Telegram iniciado para negocio ${businessId}: @${bot.botInfo.username}`);
  return bot;
}

/**
 * Obtiene el bot activo para un negocio.
 */
export function getBot(businessId: string): Bot | undefined {
  return activeBots.get(businessId);
}

/**
 * Detiene y elimina el bot de un negocio.
 */
export async function stopBot(businessId: string): Promise<void> {
  const bot = activeBots.get(businessId);
  if (bot) {
    try {
      // Eliminar webhook en Telegram
      await bot.api.deleteWebhook();
    } catch (error) {
      console.warn(`Error al eliminar webhook del bot (negocio ${businessId}):`, error);
    }
    activeBots.delete(businessId);
    console.log(`Bot de Telegram detenido para negocio ${businessId}`);
  }
}

/**
 * Configura el webhook del bot en Telegram.
 * @param webhookUrl URL pública donde Telegram enviará los updates.
 */
export async function setWebhook(businessId: string, webhookUrl: string): Promise<void> {
  const bot = activeBots.get(businessId);
  if (!bot) {
    throw new Error(`No hay bot activo para el negocio ${businessId}`);
  }

  await bot.api.setWebhook(webhookUrl);
  console.log(`Webhook configurado para negocio ${businessId}: ${webhookUrl}`);
}

/**
 * Procesa un update entrante de Telegram para un negocio.
 */
export async function handleUpdate(businessId: string, update: unknown): Promise<void> {
  const bot = activeBots.get(businessId);
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
  const bot = activeBots.get(businessId);
  if (!bot) return null;
  return bot.botInfo;
}

/**
 * Restaura bots al iniciar el servidor, leyendo conexiones activas de la DB.
 */
export async function restoreActiveBots(): Promise<void> {
  // Importación dinámica para evitar circularidad
  const { prisma } = await import('../../lib/prisma');

  const connections = await prisma.connection.findMany({
    where: { type: 'TELEGRAM', isActive: true },
  });

  for (const conn of connections) {
    const config = conn.config as { botToken?: string; webhookUrl?: string } | null;
    if (!config?.botToken) continue;

    try {
      await createBot(config.botToken, conn.businessId);
      if (config.webhookUrl) {
        await setWebhook(conn.businessId, config.webhookUrl);
      }
      console.log(`Bot restaurado para negocio ${conn.businessId}`);
    } catch (error) {
      console.error(`Error al restaurar bot para negocio ${conn.businessId}:`, error);
    }
  }
}
