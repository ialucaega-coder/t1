/**
 * Mr Go — memoria estructurada por negocio (patrón "memorias" de Vellum).
 *
 * El orquestador (orchestrator.ts) ruteaba SIN memoria (`history: []`): no sabía
 * nada del negocio ni de lo que venía pasando. Esta memoria liviana le da
 * contexto estable: un `profile` (qué es el negocio, tono, reglas del dueño) y
 * una lista acotada de `facts` (hechos/notas recientes: "el cliente X prefiere
 * turnos de mañana", "promo vigente hasta el viernes", etc.). Se inyecta al
 * prompt de sistema del orquestador.
 *
 * Persistencia: schema congelado → Connection con type='MRGO_MEMORY' (un registro
 * por negocio), `config Json?` = `{ profile: string, facts: string[] }`. Mismo
 * patrón (tx + SELECT ... FOR UPDATE) que el resto de los módulos de Mr Go.
 */
import { prisma } from '../../lib/prisma';

const MEMORY_CONNECTION_TYPE = 'MRGO_MEMORY';
const MEMORY_CONNECTION_NAME = 'Memoria de Mr Go';

/** Topes para que el JSON (y el prompt) no crezcan sin control. */
export const MAX_PROFILE_LEN = 2000;
export const MAX_FACT_LEN = 300;
export const MAX_FACTS = 50;

export interface MrGoMemory {
  profile: string;
  facts: string[];
}

function clampText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

/** Normaliza una config arbitraria a una memoria válida (defensivo, datos de API). */
export function sanitizeMemory(config: unknown): MrGoMemory {
  const cfg =
    config && typeof config === 'object' && !Array.isArray(config)
      ? (config as Record<string, unknown>)
      : {};
  const profile = clampText(cfg.profile, MAX_PROFILE_LEN);
  const rawFacts = Array.isArray(cfg.facts) ? cfg.facts : [];
  const facts: string[] = [];
  for (const f of rawFacts) {
    const clean = clampText(f, MAX_FACT_LEN);
    if (clean) facts.push(clean);
    if (facts.length >= MAX_FACTS) break;
  }
  return { profile, facts };
}

/** Devuelve la memoria del negocio (vacía si no hay). */
export async function loadMemory(businessId: string): Promise<MrGoMemory> {
  const conn = await prisma.connection.findFirst({
    where: { businessId, type: MEMORY_CONNECTION_TYPE },
  });
  return sanitizeMemory(conn?.config);
}

/** Persiste la memoria completa (atómico, FOR UPDATE). Devuelve lo que quedó. */
export async function saveMemory(businessId: string, input: Partial<MrGoMemory>): Promise<MrGoMemory> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.connection.findFirst({
      where: { businessId, type: MEMORY_CONNECTION_TYPE },
      select: { id: true },
    });

    // Merge sobre lo guardado: permite actualizar solo `profile` o solo `facts`.
    let current: MrGoMemory = { profile: '', facts: [] };
    if (existing) {
      await tx.$queryRaw`SELECT id FROM "connections" WHERE id = ${existing.id} FOR UPDATE`;
      const fresh = await tx.connection.findUnique({ where: { id: existing.id }, select: { config: true } });
      current = sanitizeMemory(fresh?.config);
    }
    const merged = sanitizeMemory({
      profile: input.profile !== undefined ? input.profile : current.profile,
      facts: input.facts !== undefined ? input.facts : current.facts,
    });

    if (!existing) {
      await tx.connection.create({
        data: {
          name: MEMORY_CONNECTION_NAME,
          type: MEMORY_CONNECTION_TYPE,
          icon: 'Brain',
          isActive: true,
          config: merged as unknown as object,
          businessId,
        },
      });
    } else {
      await tx.connection.update({
        where: { id: existing.id },
        data: { config: merged as unknown as object, isActive: true },
      });
    }
    return merged;
  });
}

/**
 * Construye la sección de memoria para el prompt de sistema del orquestador.
 * Devuelve '' si no hay nada (así no ensucia el prompt cuando no hay memoria).
 */
export function buildMemoryPrompt(mem: MrGoMemory): string {
  const parts: string[] = [];
  if (mem.profile) parts.push(`PERFIL DEL NEGOCIO:\n${mem.profile}`);
  if (mem.facts.length) {
    parts.push(`HECHOS RECIENTES A TENER EN CUENTA:\n${mem.facts.map((f) => `- ${f}`).join('\n')}`);
  }
  return parts.join('\n\n');
}
