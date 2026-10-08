import { httpClient } from './http-client';

export interface BusinessSettings {
  businessName: string;
  slug: string;
  phone: string;
  email: string;
  address: string;
  timezone: string;
  currency: string;
  theme: string;
  accentColor: string;
  aiProviders: string[];
}

export function getSettings() {
  return httpClient.get<BusinessSettings>('/settings');
}

export function updateSettings(data: Partial<BusinessSettings>) {
  return httpClient.put<BusinessSettings>('/settings', data);
}

// La configuración de proveedores de IA ("usá tu propia IA") se maneja desde el
// Motor de IA real (lib/api/ai.ts: getEngines / setEngine / setEngineKey), que es
// lo que el bot efectivamente usa. El stub /settings/ai-providers fue eliminado.
