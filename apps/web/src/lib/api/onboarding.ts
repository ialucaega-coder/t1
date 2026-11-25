import { httpClient } from './http-client';

/** Un paso del checklist de puesta en marcha. */
export interface ChecklistItem {
  id: string;
  label: string;
  description: string;
  done: boolean;
  href: string;
}

/** Checklist de onboarding calculado desde el estado real del negocio. */
export interface Onboarding {
  items: ChecklistItem[];
  completed: number;
  total: number;
  percent: number;
  dismissed: boolean;
}

export function getOnboarding() {
  return httpClient.get<Onboarding>('/onboarding');
}

export function dismissOnboarding(dismissed: boolean) {
  return httpClient.put<Onboarding>('/onboarding/dismiss', { dismissed });
}
