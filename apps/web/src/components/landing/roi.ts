/**
 * Cálculo de la calculadora de ahorro. Es una ESTIMACIÓN con supuestos que el
 * usuario puede mover (cuánto resuelve el robot solo, cuánto vale su hora): no
 * promete resultados, solo hace la cuenta con lo que cada negocio ingresa.
 */
export interface RoiInput {
  /** Consultas que recibe por día. */
  perDay: number;
  /** Minutos que tarda en atender cada una. */
  minutes: number;
  /** Valor de su hora de trabajo (USD). */
  hourValue: number;
  /** % de consultas que el robot resolvería solo (estimado, editable). */
  autoPct: number;
}

export interface Plan {
  name: string;
  price: number;
  /** Mensajes/mes incluidos; null = ilimitados. */
  messages: number | null;
}

/** Mismos topes que los planes mostrados en la landing. */
export const PLANS: Plan[] = [
  { name: 'Gratis', price: 0, messages: 500 },
  { name: 'Starter', price: 29, messages: 5000 },
  { name: 'Pro', price: 79, messages: 25000 },
  { name: 'Enterprise', price: 199, messages: null },
];

const DAYS = 30;

export function recommendPlan(messagesPerMonth: number): Plan {
  return PLANS.find((p) => p.messages === null || messagesPerMonth <= p.messages) as Plan;
}

export function computeRoi({ perDay, minutes, hourValue, autoPct }: RoiInput) {
  const messagesPerMonth = Math.max(0, perDay) * DAYS;
  const hoursSaved = (messagesPerMonth * Math.max(0, minutes) * (autoPct / 100)) / 60;
  const moneySaved = hoursSaved * Math.max(0, hourValue);
  const plan = recommendPlan(messagesPerMonth);
  return {
    messagesPerMonth,
    hoursSaved: Math.round(hoursSaved),
    moneySaved: Math.round(moneySaved),
    plan,
    net: Math.round(moneySaved - plan.price),
  };
}
