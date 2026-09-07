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

export interface AiProviderInfo {
  key: string;
  label: string;
  configured: boolean;
  isActive: boolean;
  id: string | null;
}

export function getAiProviders() {
  return httpClient.get<AiProviderInfo[]>('/settings/ai-providers');
}

export function updateAiProvider(key: string, data: { apiKey?: string; isActive?: boolean }) {
  return httpClient.put<AiProviderInfo>(`/settings/ai-providers/${key}`, data);
}

export function deleteAiProvider(key: string) {
  return httpClient.delete(`/settings/ai-providers/${key}`);
}
