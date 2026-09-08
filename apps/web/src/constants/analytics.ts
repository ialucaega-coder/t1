export const DAILY_CONVERSATIONS = [
  { day: 'Lun', count: 42 },
  { day: 'Mar', count: 58 },
  { day: 'Mié', count: 35 },
  { day: 'Jue', count: 67 },
  { day: 'Vie', count: 51 },
  { day: 'Sáb', count: 28 },
  { day: 'Dom', count: 15 },
];

export const SATISFACTION_DISTRIBUTION = [
  { stars: 5, count: 124, color: '#10B981' },
  { stars: 4, count: 89, color: '#38BDF8' },
  { stars: 3, count: 32, color: '#F59E0B' },
  { stars: 2, count: 11, color: '#F97316' },
  { stars: 1, count: 4, color: '#EF4444' },
];

export const SUGGESTED_IMPROVEMENTS = [
  { id: '1', title: 'Agregar horarios de fin de semana', category: 'Contenido', severity: 'alta' as const, description: 'El bot no pudo responder 23 consultas sobre disponibilidad sábado/domingo.' },
  { id: '2', title: 'Mejorar respuesta sobre precios', category: 'Ventas', severity: 'alta' as const, description: 'Detectamos 18 oportunidades de venta perdidas por respuestas vagas sobre precios.' },
  { id: '3', title: 'Agregar info de estacionamiento', category: 'Ubicación', severity: 'media' as const, description: '12 clientes preguntaron si hay estacionamiento cerca.' },
  { id: '4', title: 'Responder sobre formas de pago', category: 'Pagos', severity: 'media' as const, description: '9 consultas sobre si aceptan transferencia o MercadoPago.' },
  { id: '5', title: 'Incluir política de cancelación', category: 'Políticas', severity: 'baja' as const, description: '5 clientes preguntaron sobre la política de cancelación.' },
];

export const AI_COSTS = [
  { model: 'Claude Sonnet 5', tokens: 2_450_000, cost: 12.25 },
  { model: 'Claude Haiku 4.5', tokens: 8_200_000, cost: 8.20 },
  { model: 'Whisper (voz)', tokens: 0, cost: 3.50 },
  { model: 'Vision (fotos)', tokens: 0, cost: 1.80 },
];

export const KPI_SUMMARY = {
  totalConversations: 296,
  conversationsChange: 0,
  avgSatisfaction: 4.3,
  satisfactionChange: 0,
  monthlyAiCost: 25.75,
  aiCostChange: 0,
  conversionRate: 34.2,
  conversionChange: 0,
  monthlyBudget: 50,
};
