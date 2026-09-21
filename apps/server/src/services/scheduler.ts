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
 * Cada negocio se procesa en su propio try/catch para que un error no frene
 * al resto — pensado para escalar a muchos negocios.
 */
import cron from 'node-cron';
import { prisma } from '../lib/prisma';
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

/** Corre los reportes diarios de todos los negocios con el superpoder activo. */
export async function runDailyReports(): Promise<void> {
  const businessIds = await businessesWithSuperpower(REPORT_SUPERPOWER);
  for (const businessId of businessIds) {
    try {
      const userId = await adminUserId(businessId);
      if (!userId) continue;
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
    } catch (err) {
      console.error(`[scheduler] Error en reporte diario de ${businessId}:`, err);
    }
  }
}

/** Corre los recordatorios de mañana de todos los negocios con el superpoder activo. */
export async function runReminders(): Promise<void> {
  const businessIds = await businessesWithSuperpower(REMINDER_SUPERPOWER);
  for (const businessId of businessIds) {
    try {
      const userId = await adminUserId(businessId);
      if (!userId) continue;
      const reminders = await generateReminders(businessId);
      if (reminders.length === 0) continue;
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
    } catch (err) {
      console.error(`[scheduler] Error en recordatorios de ${businessId}:`, err);
    }
  }
}

/** Recupera los no-shows del día de cada negocio con el superpoder activo. */
export async function runNoShowRecovery(): Promise<void> {
  const businessIds = await businessesWithSuperpower(NOSHOW_SUPERPOWER);
  for (const businessId of businessIds) {
    try {
      const userId = await adminUserId(businessId);
      if (!userId) continue;
      const items = await generateNoShowRecovery(businessId);
      if (items.length === 0) continue;
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
    } catch (err) {
      console.error(`[scheduler] Error en recuperación de no-shows de ${businessId}:`, err);
    }
  }
}

/** Seguimiento post-venta de los turnos completados ayer, por negocio con el superpoder activo. */
export async function runPostSaleFollowUps(): Promise<void> {
  const businessIds = await businessesWithSuperpower(POSTSALE_SUPERPOWER);
  for (const businessId of businessIds) {
    try {
      const userId = await adminUserId(businessId);
      if (!userId) continue;
      const items = await generatePostSaleFollowUps(businessId);
      if (items.length === 0) continue;
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
    } catch (err) {
      console.error(`[scheduler] Error en seguimiento post-venta de ${businessId}:`, err);
    }
  }
}

let started = false;

/** Programa los jobs diarios. Idempotente (no duplica los cron). */
export function startScheduler(): void {
  if (started || process.env.NODE_ENV === 'test') return;
  started = true;

  // Reporte diario a las 20:00 (hora del servidor).
  cron.schedule('0 20 * * *', () => {
    runDailyReports().catch((err) => console.error('[scheduler] runDailyReports:', err));
  });

  // Recordatorios de las reservas de mañana, a las 09:00.
  cron.schedule('0 9 * * *', () => {
    runReminders().catch((err) => console.error('[scheduler] runReminders:', err));
  });

  // Recuperación de no-shows, a las 21:00 (cierre del día).
  cron.schedule('0 21 * * *', () => {
    runNoShowRecovery().catch((err) => console.error('[scheduler] runNoShowRecovery:', err));
  });

  // Seguimiento post-venta de los turnos completados ayer, a las 11:00.
  cron.schedule('0 11 * * *', () => {
    runPostSaleFollowUps().catch((err) => console.error('[scheduler] runPostSaleFollowUps:', err));
  });

  console.log('[scheduler] Jobs de superpoderes programados (reporte 20:00, recordatorios 09:00, no-shows 21:00, post-venta 11:00)');
}
