import { httpClient } from './http-client';

export interface Template {
  id: string;
  name: string;
  description: string | null;
  type: string;
  content: string;
  category: string | null;
  businessId: string;
}

export function getTemplates(type?: string) {
  const params = type ? `?type=${type}` : '';
  return httpClient.get<Template[]>(`/templates${params}`);
}

export function createTemplate(data: { name: string; description?: string; content: string; category?: string; type: string }) {
  return httpClient.post<Template>('/templates', data);
}

export function updateTemplate(id: string, data: Partial<{ name: string; description: string; content: string; category: string }>) {
  return httpClient.patch<Template>(`/templates/${id}`, data);
}

export function deleteTemplate(id: string) {
  return httpClient.delete<void>(`/templates/${id}`);
}
