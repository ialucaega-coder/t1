import { httpClient } from './http-client';

/** Un ítem de catálogo (trigger o acción) para los dropdowns. */
export interface CatalogItem {
  key: string;
  label: string;
  description: string;
}

/** Una regla de automatización. */
export interface WorkflowRule {
  id: string;
  nombre: string;
  activo: boolean;
  trigger: string;
  condicion?: string;
  accion: string;
}

export interface WorkflowsResponse {
  rules: WorkflowRule[];
  triggers: CatalogItem[];
  actions: CatalogItem[];
}

export interface CreateRuleInput {
  nombre: string;
  trigger: string;
  accion: string;
  condicion?: string;
  activo?: boolean;
}

export type UpdateRuleInput = Partial<CreateRuleInput>;

/** Lista reglas + catálogos de triggers y acciones. */
export function list() {
  return httpClient.get<WorkflowsResponse>('/workflows');
}

export function create(data: CreateRuleInput) {
  return httpClient.post<WorkflowRule>('/workflows', data);
}

export function update(id: string, data: UpdateRuleInput) {
  return httpClient.patch<WorkflowRule>(`/workflows/${id}`, data);
}

export function remove(id: string) {
  return httpClient.delete<void>(`/workflows/${id}`);
}
