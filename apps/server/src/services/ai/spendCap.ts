/**
 * Tope mensual de gasto de IA por negocio (en USD).
 *
 * Persistencia sin schema: una `Connection` (type 'AI_SPEND_CAP') por negocio con
 *   { capUsd: number | null, alerts: { month: 'YYYY-MM', warned: boolean, blocked: boolean } }
 *
 * - Sin tope (`capUsd` null/ausente) no hay corte ni costo extra por mensaje
 *   (solo una lectura cacheada de la config).
 * - Al 80 % se avisa UNA vez por mes al ADMIN; al 100 % se avisa y se corta: el
 *   proveedor deja de resolverse (el bot degrada con su mensaje de "no puedo
 *   responder" y deriva a una persona).
 * - El gasto es una ESTIMACIÓN (ver usage.ts) y solo cubre respuestas del bot de
 *   chat con `usage` registrado. Es un tope "blando": por el TTL de caché puede
 *   permitir unos pocos mensajes de más al cruzar el límite.
 * - Fail-open: si la consulta falla, no se corta el bot por un problema de la guarda.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { cache, cacheKey } from '../../lib/cache';
import { lockSingleton } from '../../lib/singletonLock';
import { currentMonthWindow, getSpendSince } from './usage';

const CONNECTION_TYPE = 'AI_SPEND_CAP';
const STATUS_TTL_MS = 30_000;
export const WARN_AT = 0.8;
export const MAX_CAP_USD = 100_000;

export type SpendLevel = 'ok' | 'warn' | 'blocked';

export interface SpendStatus {
  capUsd: number | null;
  spentUsd: number;
  /** 0..n (puede superar 1 si ya se pasó). null sin tope. */
  ratio: number | null;
  level: SpendLevel;
  month: string;
}

interface Alerts { month: string; warned: boolean; blocked: boolean }
interface CapConfig { capUsd: number | null; alerts: Alerts }

export class SpendCapError extends Error {
  readonly code = 'AI_SPEND_CAP_REACHED';
  constructor(public readonly capUsd: number) {
    super(`Se alcanzó el tope mensual de gasto de IA (USD ${capUsd}).`);
  }
}

function parseConfig(raw: unknown): CapConfig {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const cap = typeof c.capUsd === 'number' && Number.isFinite(c.capUsd) && c.capUsd > 0 ? c.capUsd : null;
  const a = (c.alerts && typeof c.alerts === 'object' ? c.alerts : {}) as Record<string, unknown>;
  return {
    capUsd: cap,
    alerts: {
      month: typeof a.month === 'string' ? a.month : '',
      warned: a.warned === true,
      blocked: a.blocked === true,
    },
  };
}

async function loadConfig(businessId: string): Promise<CapConfig> {
  const conn = await prisma.connection.findFirst({
    where: { businessId, type: CONNECTION_TYPE },
    select: { config: true },
    orderBy: { id: 'asc' },
  });
  return parseConfig(conn?.config);
}

/** Pura: nivel según gasto y tope. */
export function levelFor(spentUsd: number, capUsd: number | null): SpendLevel {
  if (!capUsd) return 'ok';
  if (spentUsd >= capUsd) return 'blocked';
  if (spentUsd >= capUsd * WARN_AT) return 'warn';
  return 'ok';
}

/**
 * Estado actual del tope del negocio (cacheado 30 s). Sin tope solo calcula el
 * gasto si `alwaysSpend` (panel); el camino por mensaje (enforceSpendCap) no
 * paga esa query para negocios sin tope.
 */
export async function getSpendStatus(businessId: string, alwaysSpend = false): Promise<SpendStatus> {
  const key = cacheKey(businessId, 'ai-spend-status', alwaysSpend ? 'full' : 'cap');
  const cached = cache.get<SpendStatus>(key);
  if (cached) return cached;

  const { month, since } = currentMonthWindow();
  const cfg = await loadConfig(businessId);
  let status: SpendStatus;
  if (!cfg.capUsd && !alwaysSpend) {
    status = { capUsd: null, spentUsd: 0, ratio: null, level: 'ok', month };
  } else if (!cfg.capUsd) {
    const spentUsd = Math.round((await getSpendSince(businessId, since)) * 10000) / 10000;
    status = { capUsd: null, spentUsd, ratio: null, level: 'ok', month };
  } else {
    const spent = await getSpendSince(businessId, since);
    const spentUsd = Math.round(spent * 10000) / 10000;
    status = { capUsd: cfg.capUsd, spentUsd, ratio: spentUsd / cfg.capUsd, level: levelFor(spentUsd, cfg.capUsd), month };
  }
  cache.set(key, status, STATUS_TTL_MS);
  return status;
}

/** Fija (o quita, con null) el tope mensual. Reinicia los avisos del mes. */
export async function setSpendCap(businessId: string, capUsd: number | null): Promise<CapConfig> {
  if (capUsd !== null && (!Number.isFinite(capUsd) || capUsd <= 0 || capUsd > MAX_CAP_USD)) {
    throw new Error('Tope inválido');
  }
  const next = await prisma.$transaction(async (tx) => {
    await lockSingleton(tx, businessId, CONNECTION_TYPE);
    const existing = await tx.connection.findFirst({
      where: { businessId, type: CONNECTION_TYPE },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    const cfg: CapConfig = { capUsd, alerts: { month: '', warned: false, blocked: false } };
    const json = cfg as unknown as Prisma.InputJsonObject;
    if (existing) {
      await tx.connection.update({ where: { id: existing.id }, data: { config: json, isActive: true } });
    } else {
      await tx.connection.create({
        data: { name: 'Tope de gasto de IA', type: CONNECTION_TYPE, icon: 'Gauge', config: json, isActive: true, businessId },
      });
    }
    return cfg;
  });
  cache.invalidate(cacheKey(businessId, 'ai-spend'));
  return next;
}

/**
 * Marca el aviso como enviado para este mes (atómico) y devuelve true solo la
 * primera vez, así el ADMIN recibe un único aviso por umbral y por mes aunque
 * lleguen mensajes concurrentes o haya varias instancias.
 */
async function claimAlert(businessId: string, month: string, which: 'warned' | 'blocked'): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await lockSingleton(tx, businessId, CONNECTION_TYPE);
    const conn = await tx.connection.findFirst({
      where: { businessId, type: CONNECTION_TYPE },
      select: { id: true, config: true },
      orderBy: { id: 'asc' },
    });
    if (!conn) return false;
    const cfg = parseConfig(conn.config);
    const alerts: Alerts = cfg.alerts.month === month ? { ...cfg.alerts } : { month, warned: false, blocked: false };
    if (alerts[which]) return false;
    alerts[which] = true;
    // Al cortar por 100 % también damos por avisado el 80 %.
    if (which === 'blocked') alerts.warned = true;
    await tx.connection.update({
      where: { id: conn.id },
      data: { config: { ...cfg, alerts } as unknown as Prisma.InputJsonObject },
    });
    return true;
  });
}

async function notifyAdmin(businessId: string, level: 'warn' | 'blocked', status: SpendStatus): Promise<void> {
  const admin = await prisma.user.findFirst({ where: { businessId, role: 'ADMIN' }, select: { id: true } });
  if (!admin) return;
  const pct = Math.round((status.ratio ?? 0) * 100);
  await prisma.notification.create({
    data: {
      userId: admin.id,
      type: 'GENERAL',
      channel: 'PUSH',
      title: level === 'blocked' ? 'Tope de gasto de IA alcanzado' : 'Gasto de IA al 80 % del tope',
      body:
        level === 'blocked'
          ? `Llegaste al tope mensual de IA (USD ${status.capUsd}). El asistente deja de responder solo hasta el mes que viene o hasta que subas el tope.`
          : `Llevás USD ${status.spentUsd.toFixed(2)} de USD ${status.capUsd} este mes (${pct} %).`,
      businessId,
    },
  });
}

/**
 * Llamar antes de resolver el proveedor de IA. Lanza SpendCapError si el negocio
 * llegó al 100 % de su tope; al cruzar 80 %/100 % avisa al ADMIN (una vez por mes).
 * Cualquier otro error se traga (fail-open).
 */
export async function enforceSpendCap(businessId: string): Promise<void> {
  let status: SpendStatus;
  try {
    status = await getSpendStatus(businessId);
    if (status.level !== 'ok') {
      const which = status.level === 'blocked' ? 'blocked' : 'warned';
      // Evita una transacción por mensaje una vez avisado (la DB sigue siendo la
      // fuente de verdad entre instancias: claimAlert devuelve true una sola vez).
      const seenKey = cacheKey(businessId, 'ai-spend-alerted', status.month, which);
      if (!cache.get<boolean>(seenKey)) {
        cache.set(seenKey, true, 60 * 60 * 1000);
        if (await claimAlert(businessId, status.month, which)) {
          await notifyAdmin(businessId, status.level, status).catch(() => {});
        }
      }
    }
  } catch (err) {
    console.error('Error consultando el tope de gasto de IA (fail-open):', (err as Error).message);
    return;
  }
  if (status.level === 'blocked' && status.capUsd) throw new SpendCapError(status.capUsd);
}
