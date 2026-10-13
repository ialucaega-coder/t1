/**
 * Ajustes de automatización por negocio — el "gate" de ejecución en vivo.
 *
 * Las automatizaciones (Workflows) se disparan desde el pipeline cuando pasa un
 * evento real (mensaje entrante, nueva reserva, pago, lead). Pero auto-EJECUTAR
 * acciones salientes (ej: enviar WhatsApp a un cliente) es irreversible, así que
 * NO queremos que ocurra sin que el dueño lo habilite explícitamente.
 *
 * Por eso cada negocio tiene un flag `live`:
 *  - `live: false` (DEFAULT, seguro): el pipeline corre las reglas en `dry_run`
 *    → las acciones internas (mover etapa, notificar) se ejecutan, las externas
 *    se SIMULAN. Nada sale al cliente.
 *  - `live: true`: el pipeline corre en `live` → las acciones externas se
 *    ejecutan de verdad.
 *
 * El modo manual de prueba (`POST /api/workflows/run` con `execute`) es aparte:
 * ahí el ADMIN elige el modo explícitamente. Este flag es solo para los disparos
 * AUTOMÁTICOS del pipeline.
 *
 * Persistencia: schema congelado → Connection con type='AUTOMATION_SETTINGS'
 * (un registro por negocio), `config Json?` = `{ live: boolean }`. Mismo patrón
 * (tx + SELECT ... FOR UPDATE) que el resto.
 */
import { prisma } from '../../lib/prisma';
import type { ExecMode } from '../actions/executor';

const SETTINGS_CONNECTION_TYPE = 'AUTOMATION_SETTINGS';
const SETTINGS_CONNECTION_NAME = 'Ajustes de automatización';

/** Lee el flag `live` de una config arbitraria (false por defecto). */
function normalizeLive(config: unknown): boolean {
  const cfg =
    config && typeof config === 'object' && !Array.isArray(config)
      ? (config as Record<string, unknown>)
      : {};
  return cfg.live === true;
}

/** ¿El negocio tiene las automatizaciones automáticas en vivo? (false por defecto). */
export async function isAutomationLive(businessId: string): Promise<boolean> {
  const conn = await prisma.connection.findFirst({
    where: { businessId, type: SETTINGS_CONNECTION_TYPE },
  });
  return normalizeLive(conn?.config);
}

/** Modo de ejecución para los disparos AUTOMÁTICOS del pipeline de este negocio. */
export async function getAutomationMode(businessId: string): Promise<ExecMode> {
  return (await isAutomationLive(businessId)) ? 'live' : 'dry_run';
}

/**
 * Cambia el flag `live` del negocio. Atómico (tx + FOR UPDATE). Crea el registro
 * si no existe. Devuelve el valor que quedó vigente.
 */
export async function setAutomationLive(businessId: string, live: boolean): Promise<boolean> {
  await prisma.$transaction(async (tx) => {
    const conn = await tx.connection.findFirst({
      where: { businessId, type: SETTINGS_CONNECTION_TYPE },
      select: { id: true },
    });

    if (!conn) {
      await tx.connection.create({
        data: {
          name: SETTINGS_CONNECTION_NAME,
          type: SETTINGS_CONNECTION_TYPE,
          icon: 'Zap',
          isActive: true,
          config: { live } as unknown as object,
          businessId,
        },
      });
      return;
    }

    await tx.$queryRaw`SELECT id FROM "connections" WHERE id = ${conn.id} FOR UPDATE`;
    await tx.connection.update({
      where: { id: conn.id },
      data: { config: { live } as unknown as object, isActive: true },
    });
  });
  return live;
}
