/**
 * Scheduler de superpoderes que corren "fuera del prompt".
 *
 * Usa node-cron (ya instalado) para disparar, una vez al día:
 *   - "Reportes automaticos": arma el resumen diario de cada negocio que tenga
 *     el superpoder activo y lo deja como notificación para su ADMIN.
 *   - "Recordatorios inteligentes": genera los recordatorios de las reservas de
 *     mañana y los deja como notificación para el ADMIN (listos para enviar).
 *
 * Se arranca desde index.ts (startScheduler). No corre en entorno de test.
 * Cada negocio es un trabajo independiente de la cola `scheduler-business`: un
 * error en uno se reintenta solo y no frena al resto (ver más abajo).
 */
import cron from 'node-cron';
import { prisma } from '../lib/prisma';
import { sharedTryLock } from '../lib/sharedState';
import { defineQueue, enqueue, queuesEnabled } from '../lib/queue';
import { runPurge } from './maintenance/purge';
import {
  generateDailyReport,
  generateReminders,
  generateNoShowRecovery,
  generatePostSaleFollowUps,
} from './superpowers/report';

const REPORT_SUPERPOWER = 'Reportes automaticos';
const REMINDER_SUPERPOWER = 'Recordatorios inteligentes';
const NOSHOW_SUPERPOWER = 'Recupera no-shows';
const POSTSALE_SUPERPOWER = 'Seguimiento post-venta';

/** Negocios activos que tienen un superpoder (por nombre) activo. */
async function businessesWithSuperpower(name: string): Promise<string[]> {
  const skills = await prisma.skill.findMany({
    where: {
      name,
      isActive: true,
      business: { isActive: true },
    },
    select: { businessId: true, config: true },
  });
  const ids = skills
    .filter((s) => {
      const cfg = s.config as { kind?: string } | null;
      return cfg?.kind === 'superpower';
    })
    .map((s) => s.businessId);
  return Array.from(new Set(ids));
}

/** Devuelve el userId del ADMIN de un negocio (destino de la notificación). */
async function adminUserId(businessId: string): Promise<string | null> {
  const admin = await prisma.user.findFirst({
    where: { businessId, role: 'ADMIN' },
    select: { id: true },
  });
  return admin?.id ?? null;
}

/**
 * Jobs por negocio. Cada job diario se divide en dos pasos:
 *  1. REPARTO (cron, una sola instancia por el lock del día): lista los negocios con
 *     el superpoder activo y encola UN trabajo por negocio.
 *  2. PROCESO (worker de la cola `scheduler-business`): arma el contenido y crea la
 *     notificación de ESE negocio.
 * Con Redis, los negocios se reparten entre los workers de todas las instancias, un
 * fallo de un negocio se reintenta solo (3 intentos) y no frena a los demás. Sin
 * Redis `enqueue` ejecuta inline y en orden, igual que antes.
 */
type SchedulerKind = 'report' | 'reminders' | 'noshow' | 'postsale';

interface SchedulerJob {
  kind: SchedulerKind;
  businessId: string;
}

const SCHEDULER_QUEUE = 'scheduler-business';
const SCHEDULER_ATTEMPTS = 3;

/** Contenido y notificación de cada tipo de job, para UN negocio. Lanza ante un error. */
const businessHandlers: Record<SchedulerKind, (businessId: string, userId: string) => Promise<void>> = {
  async report(businessId, userId) {
    const report = await generateDailyReport(businessId);
    await prisma.notification.create({
      data: {
        businessId,
        userId,
        type: 'GENERAL',
        channel: 'PUSH',
        title: `Reporte diario — ${report.date}`,
        body: report.text,
      },
    });
  },
  async reminders(businessId, userId) {
    const reminders = await generateReminders(businessId);
    if (reminders.length === 0) return;
    const body = [
      `Tenés ${reminders.length} turno(s) para mañana. Recordatorios listos para enviar:`,
      ...reminders.map((r) => `• ${r.time} — ${r.clientName} (${r.service})`),
    ].join('\n');
    await prisma.notification.create({
      data: {
        businessId,
        userId,
        type: 'BOOKING_REMINDER',
        channel: 'PUSH',
        title: `Recordatorios de mañana (${reminders.length})`,
        body,
      },
    });
  },
  async noshow(businessId, userId) {
    const items = await generateNoShowRecovery(businessId);
    if (items.length === 0) return;
    const body = [
      `${items.length} turno(s) marcados como no-show hoy. Mensajes de recuperación listos:`,
      ...items.map((i) => `• ${i.clientName} (${i.service})`),
    ].join('\n');
    await prisma.notification.create({
      data: {
        businessId,
        userId,
        type: 'GENERAL',
        channel: 'PUSH',
        title: `Recuperá ${items.length} no-show(s) de hoy`,
        body,
      },
    });
  },
  async postsale(businessId, userId) {
    const items = await generatePostSaleFollowUps(businessId);
    if (items.length === 0) return;
    const body = [
      `${items.length} cliente(s) completaron su turno ayer. Mensajes de seguimiento listos para enviar:`,
      ...items.map((i) => `• ${i.clientName} (${i.service})`),
    ].join('\n');
    await prisma.notification.create({
      data: {
        businessId,
        userId,
        type: 'GENERAL',
        channel: 'PUSH',
        title: `Seguimiento post-venta: ${items.length} cliente(s)`,
        body,
      },
    });
  },
};

/** Trabajo de la cola: procesa un negocio. Un error se propaga (BullMQ reintenta). */
export async function processSchedulerJob({ kind, businessId }: SchedulerJob): Promise<void> {
  const userId = await adminUserId(businessId);
  if (!userId) return;
  await businessHandlers[kind](businessId, userId);
}

defineQueue<SchedulerJob>(SCHEDULER_QUEUE, processSchedulerJob, { concurrency: 5 });

/**
 * Encola un trabajo por negocio. El jobId lleva el día para dedupe: un mismo (tipo,
 * negocio, día) no se procesa dos veces aunque el reparto se dispare de nuevo.
 */
async function fanOut(kind: SchedulerKind, superpower: string): Promise<void> {
  const businessIds = await businessesWithSuperpower(superpower);
  const day = new Date().toISOString().slice(0, 10);
  // Con Redis, reintentos entre workers; inline (sin Redis) un solo intento para no
  // frenar el recorrido secuencial con esperas por backoff.
  const attempts = queuesEnabled() ? SCHEDULER_ATTEMPTS : 1;
  for (const businessId of businessIds) {
    await enqueue<SchedulerJob>(
      SCHEDULER_QUEUE,
      { kind, businessId },
      { jobId: `sched_${kind}_${day}_${businessId}`, attempts },
    );
  }
}

/** Reportes diarios de todos los negocios con el superpoder activo. */
export const runDailyReports = (): Promise<void> => fanOut('report', REPORT_SUPERPOWER);

/** Recordatorios de mañana de todos los negocios con el superpoder activo. */
export const runReminders = (): Promise<void> => fanOut('reminders', REMINDER_SUPERPOWER);

/** Recupera los no-shows del día de cada negocio con el superpoder activo. */
export const runNoShowRecovery = (): Promise<void> => fanOut('noshow', NOSHOW_SUPERPOWER);

/** Seguimiento post-venta de los turnos completados ayer. */
export const runPostSaleFollowUps = (): Promise<void> => fanOut('postsale', POSTSALE_SUPERPOWER);

let started = false;

/**
 * Corre un job diario en UNA sola instancia: toma un lock por (job, día) en el
 * almacén compartido (Redis) y solo quien lo obtiene ejecuta. Así, con N
 * instancias, los reportes/recordatorios no se duplican aunque ninguna tenga
 * `RUN_SCHEDULER=false`. Sin Redis (una instancia) el lock es local y no cambia
 * nada. El TTL (23 h) cubre el día; si la instancia que tomó el lock cae a mitad
 * del job, ese job no se reintenta hasta el día siguiente (preferible a duplicar
 * avisos a todos los clientes).
 */
async function runExclusive(job: string, fn: () => Promise<void>): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  if (!(await sharedTryLock(`sched:${job}:${day}`, 23 * 60 * 60 * 1000))) {
    console.log(`[scheduler] ${job}: otra instancia ya lo corre hoy, se omite`);
    return;
  }
  await fn();
}

/**
 * Programa los jobs diarios. Idempotente (no duplica los cron).
 *
 * Escalado horizontal: los cron viven en la memoria de cada proceso, pero cada
 * disparo toma un lock por (job, día) en Redis (`runExclusive`), así que con N
 * instancias el job corre una sola vez. `RUN_SCHEDULER=false` sigue sirviendo para
 * dejar una instancia fuera de los jobs (p. ej. las que solo atienden tráfico).
 */
export function startScheduler(): void {
  if (started || process.env.NODE_ENV === 'test') return;

  if (process.env.RUN_SCHEDULER === 'false') {
    console.log('[scheduler] Deshabilitado por RUN_SCHEDULER=false (otra instancia corre los jobs)');
    return;
  }
  started = true;

  // Reporte diario a las 20:00 (hora del servidor).
  cron.schedule('0 20 * * *', () => {
    runExclusive('daily-reports', runDailyReports).catch((err) => console.error('[scheduler] runDailyReports:', err));
  });

  // Recordatorios de las reservas de mañana, a las 09:00.
  cron.schedule('0 9 * * *', () => {
    runExclusive('reminders', runReminders).catch((err) => console.error('[scheduler] runReminders:', err));
  });

  // Recuperación de no-shows, a las 21:00 (cierre del día).
  cron.schedule('0 21 * * *', () => {
    runExclusive('no-show-recovery', runNoShowRecovery).catch((err) => console.error('[scheduler] runNoShowRecovery:', err));
  });

  // Seguimiento post-venta de los turnos completados ayer, a las 11:00.
  cron.schedule('0 11 * * *', () => {
    runExclusive('post-sale', runPostSaleFollowUps).catch((err) => console.error('[scheduler] runPostSaleFollowUps:', err));
  });

  // Purga de OTP vencidos y claves de idempotencia viejas, a las 04:00 (poco tráfico).
  cron.schedule('0 4 * * *', () => {
    runExclusive('purge', async () => {
      await runPurge();
    }).catch((err) => console.error('[scheduler] runPurge:', err));
  });

  console.log('[scheduler] Jobs de superpoderes programados (reporte 20:00, recordatorios 09:00, no-shows 21:00, post-venta 11:00, purga 04:00)');
}
