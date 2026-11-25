import { httpClient } from './http-client';

export interface TemplateService {
  name: string;
  description: string;
  price: number;
  durationMin: number;
}

export interface IndustryTemplate {
  id: string;
  nombre: string;
  icono: string;
  descripcion: string;
  servicios: TemplateService[];
  prompt: string;
  superpoderes: string[];
}

export interface ApplyTemplateResult {
  success: boolean;
  plantilla: { id: string; nombre: string };
  serviciosCreados: number;
  serviciosOmitidos: number;
  promptAplicado: string;
  superpoderesActivados: string[];
}

export function getIndustryTemplates() {
  return httpClient.get<IndustryTemplate[]>('/plantillas-negocio');
}

export function applyIndustryTemplate(id: string) {
  return httpClient.post<ApplyTemplateResult>(`/plantillas-negocio/${encodeURIComponent(id)}/aplicar`, {});
}
