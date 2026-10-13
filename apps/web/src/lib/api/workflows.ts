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

/** Resultado de ejecutar (o simular) una acción. */
export interface ActionResult {
  action: string;
  kind: 'interno' | 'externo';
  ok: boolean;
  status: 'ejecutado' | 'simulado' | 'no_soportado' | 'omitido' | 'error';
  detail: string;
  data?: Record<string, unknown>;
}

/** Una regla disparada y el resultado de su acción. */
export interface RunResultItem {
  ruleId: string;
  nombre: string;
  accion: string;
  result: ActionResult;
}

export interface RunWorkflowResponse {
  trigger: string;
  mode: 'dry_run' | 'live';
  matched: number;
  results: RunResultItem[];
}

export interface RunWorkflowOptions {
  payload?: Record<string, unknown>;
  execute?: boolean;
}

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

/**
 * Dispara las reglas de un trigger y devuelve qué hizo cada acción.
 * Por defecto hace dry-run (simula las acciones externas como enviar WhatsApp);
 * con `execute: true` las corre EN VIVO. Solo ADMIN (lo exige el backend).
 */
export function runWorkflow(trigger: string, opts?: RunWorkflowOptions) {
  return httpClient.post<RunWorkflowResponse>('/workflows/run', {
    trigger,
    payload: opts?.payload,
    execute: opts?.execute ?? false,
  });
}

export interface AutomationSettings {
  live: boolean;
}

/** Lee si las automatizaciones automáticas del negocio corren en vivo. */
export function getSettings() {
  return httpClient.get<AutomationSettings>('/workflows/settings');
}

/** Activa/desactiva la ejecución en vivo de las automatizaciones (solo ADMIN). */
export function setSettings(live: boolean) {
  return httpClient.put<AutomationSettings>('/workflows/settings', { live });
}
