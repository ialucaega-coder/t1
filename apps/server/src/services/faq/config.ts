/**
 * Base de conocimiento / FAQ del bot.
 *
 * Mejora inspirada en la competencia (el "empleado IA" de SalesMartly y las
 * "Preguntas frecuentes" de ForjaBots): en vez de un blob de texto libre, el
 * dueño gestiona una LISTA estructurada de pregunta→respuesta. El bot la usa
 * para contestar solo las consultas más comunes del negocio. Esto se inyecta en
 * el prompt de sistema del chatbot (ver services/chatbot.ts).
 *
 * Persistencia: schema de Prisma congelado, así que guardamos la lista en el
 * modelo `Connection` con type='FAQ_KB' (un registro por negocio), reutilizando
 * `config Json?`. Mismo patrón que la Voz de Marca (type='BRAND').
 */
import { randomUUID } from 'crypto';
import { prisma } from '../../lib/prisma';

const FAQ_CONNECTION_TYPE = 'FAQ_KB';
const FAQ_CONNECTION_NAME = 'Base de conocimiento';

/** Tope de entradas por negocio (evita un prompt gigante y un JSON enorme). */
export const MAX_FAQ_ITEMS = 100;
/** Topes de longitud por campo. */
export const MAX_QUESTION_LEN = 300;
export const MAX_ANSWER_LEN = 1500;

/** Una entrada de la base de conocimiento. */
export interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

function clampText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

/**
 * Normaliza y valida una lista entrante: descarta entradas sin pregunta o sin
 * respuesta, recorta longitudes, reusa el id si vino (o genera uno) y aplica el
 * tope de cantidad. Determinístico y defensivo (sirve para datos de la API).
 */
export function sanitizeFaqItems(raw: unknown): FaqItem[] {
  if (!Array.isArray(raw)) return [];
  const out: FaqItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const question = clampText(e.question, MAX_QUESTION_LEN);
    const answer = clampText(e.answer, MAX_ANSWER_LEN);
    if (!question || !answer) continue; // ambas obligatorias
    const id = typeof e.id === 'string' && e.id.trim() ? e.id.trim().slice(0, 64) : randomUUID();
    out.push({ id, question, answer });
    if (out.length >= MAX_FAQ_ITEMS) break;
  }
  return out;
}

function normalize(config: unknown): FaqItem[] {
  const cfg =
    config && typeof config === 'object' && !Array.isArray(config)
      ? (config as Record<string, unknown>)
      : {};
  return sanitizeFaqItems(cfg.items);
}

/** Devuelve la base de conocimiento del negocio (lista vacía si no hay). */
export async function loadFaqItems(businessId: string): Promise<FaqItem[]> {
  const conn = await prisma.connection.findFirst({
    where: { businessId, type: FAQ_CONNECTION_TYPE },
  });
  return normalize(conn?.config);
}

/**
 * Reemplaza la lista completa de FAQ del negocio (la UI manda la lista entera).
 *
 * Atómico: transacción con `SELECT ... FOR UPDATE` para no pisar un guardado
 * concurrente. Crea el registro Connection si no existe. Devuelve la lista ya
 * saneada que quedó persistida.
 */
export async function saveFaqItems(businessId: string, items: unknown): Promise<FaqItem[]> {
  const clean = sanitizeFaqItems(items);
  return prisma.$transaction(async (tx) => {
    let conn = await tx.connection.findFirst({
      where: { businessId, type: FAQ_CONNECTION_TYPE },
      select: { id: true },
    });

    if (!conn) {
      conn = await tx.connection.create({
        data: {
          name: FAQ_CONNECTION_NAME,
          type: FAQ_CONNECTION_TYPE,
          icon: 'BookOpen',
          isActive: true,
          config: { items: clean } as unknown as object,
          businessId,
        },
        select: { id: true },
      });
    } else {
      await tx.$queryRaw`SELECT id FROM "connections" WHERE id = ${conn.id} FOR UPDATE`;
      await tx.connection.update({
        where: { id: conn.id },
        data: { config: { items: clean } as unknown as object, isActive: true },
      });
    }
    return clean;
  });
}

/**
 * Convierte la base de conocimiento en un fragmento de prompt listo para
 * inyectar. Devuelve '' si no hay entradas (no ensucia el prompt).
 */
export function buildFaqPrompt(items: FaqItem[]): string {
  if (!items.length) return '';
  const lines = items.map((it, i) => `${i + 1}. P: ${it.question}\n   R: ${it.answer}`);
  return [
    'BASE DE CONOCIMIENTO DEL NEGOCIO (preguntas frecuentes). Usá estas respuestas',
    'como fuente de verdad cuando apliquen; si una consulta no está acá, respondé',
    'normalmente con el resto del contexto:',
    ...lines,
  ].join('\n');
}
