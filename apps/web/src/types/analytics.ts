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
}

export interface AnalyticsConversation {
  day: string;
  count: number;
}

export interface AnalyticsSatisfaction {
  stars: number;
  count: number;
  color: string;
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
