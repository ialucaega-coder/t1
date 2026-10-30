/**
 * Mr Go — GIRO del negocio ("bots por giro").
 *
 * El dueño elige el rubro de su negocio (uno de los 14 de INDUSTRY_TEMPLATES) y
 * Mr Go adopta ESE TONO/PERSONALIDAD al coordinar y delegar: la guía de estilo
 * del giro se inyecta en el system prompt del orquestador y del loop agéntico
 * (igual que la memoria). NO crea servicios ni skills — eso lo hace la plantilla
 * completa (`routes/industryTemplates.ts` POST /aplicar), que es un flujo aparte.
 *
 * Persistencia: schema de Prisma CONGELADO → se guarda en `Connection` con
 * type='MRGO_INDUSTRY' (un registro por negocio), campo `config` JSON como
 * `{ giroId }`. Mismo patrón que office.ts / memory.ts: transacción con
 * `SELECT ... FOR UPDATE` al escribir para no pisar guardados concurrentes.
 */
import { prisma } from '../../lib/prisma';
import { INDUSTRY_TEMPLATES, getIndustryTemplate } from '../../constants/industryTemplates';

const MRGO_INDUSTRY_TYPE = 'MRGO_INDUSTRY';
const MRGO_INDUSTRY_NAME = 'Giro de Mr Go';

/** Ids válidos de giro (del catálogo de plantillas). */
const GIRO_IDS: ReadonlySet<string> = new Set(INDUSTRY_TEMPLATES.map((t) => t.id));

/** Estado del giro del negocio: qué rubro eligió (vacío = ninguno). */
export interface IndustryState {
  giroId: string;
}

/**
 * Normaliza defensivamente el estado guardado: `giroId` solo si pertenece al
 * catálogo; cualquier otra cosa queda en '' (sin giro). Determinístico.
 */
export function sanitizeIndustry(raw: unknown): IndustryState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { giroId: '' };
  const giroId = (raw as Record<string, unknown>).giroId;
  return { giroId: typeof giroId === 'string' && GIRO_IDS.has(giroId) ? giroId : '' };
}

/** Lee el giro elegido del negocio (saneado). */
export async function loadIndustry(businessId: string): Promise<IndustryState> {
  const conn = await prisma.connection.findFirst({
    where: { businessId, type: MRGO_INDUSTRY_TYPE },
  });
  return sanitizeIndustry(conn?.config);
}

/**
 * Persiste el giro del negocio. Atómico: transacción con `SELECT ... FOR UPDATE`
 * (crea el Connection si no existe). Devuelve el estado saneado vigente.
 */
export async function saveIndustry(businessId: string, input: unknown): Promise<IndustryState> {
  const clean = sanitizeIndustry(input);
  return prisma.$transaction(async (tx) => {
    let conn = await tx.connection.findFirst({
      where: { businessId, type: MRGO_INDUSTRY_TYPE },
      select: { id: true },
    });

    if (!conn) {
      conn = await tx.connection.create({
        data: {
          name: MRGO_INDUSTRY_NAME,
          type: MRGO_INDUSTRY_TYPE,
          icon: 'Store',
          isActive: true,
          config: clean as unknown as object,
          businessId,
        },
        select: { id: true },
      });
    } else {
      await tx.$queryRaw`SELECT id FROM "connections" WHERE id = ${conn.id} FOR UPDATE`;
      await tx.connection.update({
        where: { id: conn.id },
        data: { config: clean as unknown as object, isActive: true },
      });
    }
    return clean;
  });
}

/**
 * Arma el fragmento de system prompt con el TONO del giro elegido, para
 * inyectarlo en la orquestación (como la memoria). Devuelve '' si no hay giro
 * configurado o el id no existe (no afecta el prompt).
 */
export function buildIndustryPrompt(giroId: string): string {
  const t = giroId ? getIndustryTemplate(giroId) : undefined;
  if (!t) return '';
  return [
    `RUBRO DEL NEGOCIO: ${t.nombre}.`,
    'Guía de tono y estilo para atender a los clientes de este rubro:',
    t.prompt,
    'Adoptá este rubro y tono al coordinar, delegar y responder.',
  ].join('\n');
}
