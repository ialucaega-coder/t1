import { httpClient } from './http-client';

export interface Plan {
  id: string;
  name: string;
  tier: string;
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  maxBots: number;
  maxMessages: number;
  maxContacts: number;
  features: string[];
  isActive: boolean;
}

export interface Subscription {
  id: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  stripeSubscriptionId: string | null;
  plan: Plan;
}

export interface Invoice {
  id: string;
  number: string;
  status: string;
  amount: number;
  currency: string;
  description: string | null;
  dueDate: string;
  paidAt: string | null;
  createdAt: string;
}

export function getPlans() {
  return httpClient.get<Plan[]>('/billing/plans');
}

export function getSubscription() {
  return httpClient.get<Subscription | null>('/billing/subscription');
}

export function getInvoices() {
  return httpClient.get<Invoice[]>('/billing/invoices');
}

export function createCheckoutSession(planId: string, interval: 'monthly' | 'yearly' = 'monthly') {
  return httpClient.post<{ url: string }>('/billing/subscribe', { planId, interval });
}

export function createPortalSession() {
  return httpClient.post<{ url: string }>('/billing/portal', {});
}

export function cancelSubscription() {
  return httpClient.post<Subscription>('/billing/cancel', {});
}

export function createPaymentLink(amount: number, description: string, currency?: string) {
  return httpClient.post<{ url: string }>('/billing/payment-link', { amount, description, currency });
}
