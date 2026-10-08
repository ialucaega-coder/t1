/**
 * Checklist de puesta en marcha (onboarding).
 *
 * Ingeniería inversa de la "setup guide" de SalesMartly y el onboarding de
 * respond.io: en vez de una lista estática, se CALCULA desde el estado real del
 * negocio (¿tiene marca?, ¿FAQ?, ¿un bot activo?, ¿servicios?, ¿equipo?...). Así
 * el progreso refleja lo que el dueño realmente configuró y lo guía a activar su
 * cuenta para la beta.
 *
 * Persistencia: solo el flag "descartado" se guarda (schema congelado) en una
 * `Connection` type='ONBOARDING'. El resto se deriva de datos ya existentes.
 */
import { prisma } from '../../lib/prisma';
import { loadBrandVoice } from '../brand/config';
import { loadFaqItems } from '../faq/config';

const ONBOARDING_CONNECTION_TYPE = 'ONBOARDING';

export interface ChecklistItem {
  id: string;
  label: string;
  description: string;
  /** Si el paso ya está cumplido (derivado del estado real). */
  done: boolean;
  /** Deep-link a la pantalla del panel donde se completa. */
  href: string;
}

export interface Onboarding {
  items: ChecklistItem[];
  completed: number;
  total: number;
  /** Porcentaje 0–100 (entero). */
  percent: number;
  /** Si el dueño ocultó el checklist. */
  dismissed: boolean;
}

/** Construye el checklist consultando el estado real del negocio (en paralelo). */
export async function buildOnboarding(businessId: string): Promise<Onboarding> {
  const [brand, faq, aiEngine, botsTotal, botsActive, services, team, clients, dismissed] =
    await Promise.all([
      loadBrandVoice(businessId),
      loadFaqItems(businessId),
      prisma.connection.findFirst({ where: { businessId, type: 'AI_ENGINE' }, select: { id: true } }),
      prisma.bot.count({ where: { businessId } }),
      prisma.bot.count({ where: { businessId, status: 'ACTIVE' } }),
      prisma.service.count({ where: { businessId, deletedAt: null } }),
      prisma.teamMember.count({ where: { businessId } }),
      prisma.user.count({ where: { businessId, role: 'CLIENT', deletedAt: null } }),
      isDismissed(businessId),
    ]);

  const brandConfigured = Boolean(
    brand.tono.trim() || brand.publicoObjetivo.trim() || brand.infoNegocio.trim() || brand.reglas.trim()
  );

  const items: ChecklistItem[] = [
    {
      id: 'brand',
      label: 'Configurá la Voz de Marca',
      description: 'Definí el tono y a quién le habla tu bot en todos los canales.',
      done: brandConfigured,
      href: '/voz-de-marca',
    },
    {
      id: 'faq',
      label: 'Cargá preguntas frecuentes',
      description: 'La base de conocimiento que el bot usa para responder al toque.',
      done: faq.length > 0,
      href: '/voz-de-marca',
    },
    {
      id: 'ai-engine',
      label: 'Elegí un motor de IA',
      description: 'Seleccioná el modelo (Claude, GPT, Grok…) y cargá tu API key.',
      done: Boolean(aiEngine),
      href: '/ia',
    },
    {
      id: 'bot-created',
      label: 'Creá tu primer bot',
      description: 'Dale un nombre y un canal a tu asistente.',
      done: botsTotal > 0,
      href: '/dashboard',
    },
    {
      id: 'bot-active',
      label: 'Activá un bot',
      description: 'Ponelo en estado ACTIVO para que empiece a responder.',
      done: botsActive > 0,
      href: '/dashboard',
    },
    {
      id: 'services',
      label: 'Cargá tus servicios',
      description: 'Lo que el negocio ofrece, para reservas y catálogo.',
      done: services > 0,
      href: '/servicios',
    },
    {
      id: 'team',
      label: 'Invitá a tu equipo',
      description: 'Sumá colegas con permisos para atender y gestionar.',
      done: team > 0,
      href: '/equipo',
    },
    {
      id: 'clients',
      label: 'Sumá tu primer cliente',
      description: 'Cargá o esperá el primer cliente que reserve o escriba.',
      done: clients > 0,
      href: '/clientes',
    },
  ];

  const completed = items.filter((i) => i.done).length;
  const total = items.length;
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

  return { items, completed, total, percent, dismissed };
}

async function isDismissed(businessId: string): Promise<boolean> {
  const conn = await prisma.connection.findFirst({
    where: { businessId, type: ONBOARDING_CONNECTION_TYPE },
    select: { config: true },
  });
  const cfg = conn?.config;
  return Boolean(cfg && typeof cfg === 'object' && !Array.isArray(cfg) && (cfg as Record<string, unknown>).dismissed);
}

/** Marca el checklist como oculto/visible para el negocio. */
export async function setDismissed(businessId: string, dismissed: boolean): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const conn = await tx.connection.findFirst({
      where: { businessId, type: ONBOARDING_CONNECTION_TYPE },
      select: { id: true },
    });
    if (!conn) {
      await tx.connection.create({
        data: {
          name: 'Onboarding',
          type: ONBOARDING_CONNECTION_TYPE,
          icon: 'CheckCircle',
          isActive: true,
          config: { dismissed } as unknown as object,
          businessId,
        },
      });
    } else {
      await tx.connection.update({ where: { id: conn.id }, data: { config: { dismissed } as unknown as object } });
    }
  });
}
