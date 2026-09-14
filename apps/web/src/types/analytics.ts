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
