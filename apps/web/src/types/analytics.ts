export interface AnalyticsKpi {
  totalConversations: number;
  conversationsChange: number;
  avgSatisfaction: number;
  satisfactionChange: number;
  monthlyAiCost: number;
  aiCostChange: number;
  conversionRate: number;
  conversionChange: number;
  monthlyBudget: number;
  /** Período que cubren los números (días calendario en hora de Argentina). */
  range?: { from: string; to: string; days: number; custom: boolean };
  /** La satisfacción es una estimación (no hay calificaciones de clientes). */
  estimated?: true;
  /** En qué se basa la estimación (p. ej. 'estado_de_conversaciones'). */
  basis?: string;
}

export interface AnalyticsConversation {
  day: string;
  /** Fecha ISO del día (YYYY-MM-DD); el server la manda siempre. */
  date?: string;
  count: number;
}

export interface AnalyticsSatisfaction {
  /** Nivel 1..5 de la distribución ESTIMADA (no son calificaciones reales). */
  stars: number;
  count: number;
  color: string;
  estimated?: true;
  basis?: string;
}

export interface AnalyticsImprovement {
  id: string;
  title: string;
  category: string;
  severity: 'alta' | 'media' | 'baja';
  description: string;
}

export interface AnalyticsCost {
  model: string;
  tokens: number;
  cost: number;
}

/** Un punto de la serie temporal de 14 días (conversaciones nuevas y mensajes). */
export interface AnalyticsTimeseriesPoint {
  date: string;
  label: string;
  conversations: number;
  messages: number;
}

/** Una etapa del embudo CRM con su conversión respecto de la etapa anterior. */
export interface AnalyticsFunnelStage {
  stage: 'NEW' | 'HOT' | 'PAYMENT' | 'CUSTOMER';
  label: string;
  count: number;
  pctOfTotal: number;
  /** Conversión count[i] / count[i-1] * 100. `null` en la primera etapa. */
  conversionFromPrev: number | null;
}

export interface AnalyticsFunnel {
  total: number;
  stages: AnalyticsFunnelStage[];
}

/** Un anuncio del top por volumen en el embudo por origen (CTWA). */
export interface AnalyticsAttributionAd {
  sourceId: string;
  headline?: string;
  count: number;
}

/**
 * Embudo por origen Click-to-WhatsApp: cuántas conversaciones del negocio
 * vinieron de un anuncio vs. el total, el desglose por origen y el top de
 * anuncios por volumen.
 */
export interface AnalyticsAttribution {
  total: number;
  attributed: number;
  bySource: { source: string; count: number }[];
  byAd: AnalyticsAttributionAd[];
}
