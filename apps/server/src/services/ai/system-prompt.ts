/**
 * Prompt de sistema personalizado del negocio.
 *
 * Permite al dueño guardar un texto propio que se inyecta en el prompt de
 * sistema del chatbot (ver services/chatbot.ts, buildSystemPrompt). Se aplica a
 * TODOS los canales. Las reglas de seguridad (anti-invento, modo seguro) se
 * mantienen por encima: el prompt custom se inyecta ANTES de esas reglas.
 *
 * Persistencia: como el schema de Prisma está congelado, se guarda en el modelo
 * `Connection` con type='SYSTEM_PROMPT' (un registro por negocio), reutilizando
 * el campo `config Json?`. Mismo patrón que la Voz de Marca (type='BRAND').
 */
import { prisma } from '../../lib/prisma';

const SYSTEM_PROMPT_CONNECTION_TYPE = 'SYSTEM_PROMPT';
const SYSTEM_PROMPT_CONNECTION_NAME = 'Prompt de sistema';

/** Largo máximo del prompt custom (evita payloads enormes en el contexto). */
export const MAX_SYSTEM_PROMPT_LENGTH = 8000;

function normalize(config: unknown): string {
  const cfg = (config && typeof config === 'object' && !Array.isArray(config))
    ? (config as Record<string, unknown>)
    : {};
  return typeof cfg.prompt === 'string' ? cfg.prompt : '';
}

/** Devuelve el prompt de sistema custom del negocio (o '' si no hay). */
export async function loadSystemPrompt(businessId: string): Promise<string> {
  const conn = await prisma.connection.findFirst({
    where: { businessId, type: SYSTEM_PROMPT_CONNECTION_TYPE },
  });
  return normalize(conn?.config);
}

/**
 * Guarda el prompt de sistema custom. Crea el registro Connection
 * type='SYSTEM_PROMPT' si todavía no existe.
 *
 * Atómico: corre en transacción y bloquea la fila con `SELECT ... FOR UPDATE`
 * antes de escribir, para evitar lost-update entre dos guardados concurrentes.
 * Mismo patrón que brand/config.ts.
 */
export async function saveSystemPrompt(businessId: string, prompt: string): Promise<string> {
  const text = prompt.slice(0, MAX_SYSTEM_PROMPT_LENGTH);
  return prisma.$transaction(async (tx) => {
    let conn = await tx.connection.findFirst({
      where: { businessId, type: SYSTEM_PROMPT_CONNECTION_TYPE },
      select: { id: true },
    });

    if (!conn) {
      conn = await tx.connection.create({
        data: {
          name: SYSTEM_PROMPT_CONNECTION_NAME,
          type: SYSTEM_PROMPT_CONNECTION_TYPE,
          icon: 'MessageSquare',
          isActive: true,
          config: { prompt: text } as unknown as object,
          businessId,
        },
        select: { id: true },
      });
      return text;
    }

    await tx.$queryRaw`SELECT id FROM "connections" WHERE id = ${conn.id} FOR UPDATE`;
    await tx.connection.update({
      where: { id: conn.id },
      data: { config: { prompt: text } as unknown as object, isActive: true },
    });
    return text;
  });
}
