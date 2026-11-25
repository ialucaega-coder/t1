import { httpClient } from './http-client';

// Plantillas WhatsApp oficiales (HSM — Highly Structured Messages).
// A diferencia del `Template`/`/templates` genérico (texto libre), estas son las
// plantillas aprobadas por Meta que habilitan el broadcast fuera de la ventana
// de 24h. Persisten server-side en Connection.config (type 'WA_TEMPLATES').
// El shape es idéntico al contrato (fuente de verdad) y al server.

export type WaTemplateCategory = 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';
export type WaTemplateStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED';
export type WaButtonType = 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';

export interface WaTemplateButton {
  type: WaButtonType;
  text: string;         // etiqueta del botón (1..25 chars)
  value?: string;       // URL o teléfono según type (vacío para QUICK_REPLY)
}

export interface WaTemplate {
  id: string;                    // crypto.randomUUID() server-side
  name: string;                  // Meta exige /^[a-z0-9_]{1,512}$/ (minúsculas + _)
  language: string;              // ej 'es_AR' | 'es' | 'en' (no vacío)
  category: WaTemplateCategory;
  status: WaTemplateStatus;
  header?: string;               // encabezado de texto opcional (<=60 chars)
  body: string;                  // cuerpo, variables {{1}} {{2}}... (1..1024 chars)
  footer?: string;               // pie opcional (<=60 chars)
  buttons?: WaTemplateButton[];  // 0..3
  example?: string[];            // ejemplos para {{1..n}} (Meta los exige para aprobar)
  rejectionReason?: string;      // sólo cuando status=REJECTED
  createdAt: string;             // ISO
  updatedAt: string;             // ISO
  submittedAt?: string;          // cuándo pasó a PENDING
  reviewedAt?: string;           // cuándo pasó a APPROVED/REJECTED
}

// Payload de creación/edición. En edición (PATCH) todos los campos son opcionales
// (body parcial); por eso `create` exige los mínimos y `update` es Partial.
export interface WaTemplateInput {
  name: string;
  language: string;
  category: WaTemplateCategory;
  header?: string;
  body: string;
  footer?: string;
  buttons?: WaTemplateButton[];
  example?: string[];
}

// GET /wa-templates → { templates } (orden: updatedAt desc, lo hace el server).
export function list() {
  return httpClient.get<{ templates: WaTemplate[] }>('/wa-templates');
}

// POST /wa-templates → crea en estado DRAFT (id + timestamps server-side).
export function create(data: WaTemplateInput) {
  return httpClient.post<WaTemplate>('/wa-templates', data);
}

// PATCH /wa-templates/:id → sólo DRAFT|REJECTED. Body parcial.
export function update(id: string, data: Partial<WaTemplateInput>) {
  return httpClient.patch<WaTemplate>(`/wa-templates/${id}`, data);
}

// POST /wa-templates/:id/submit → DRAFT|REJECTED → PENDING (valida ejemplos).
export function submit(id: string) {
  return httpClient.post<WaTemplate>(`/wa-templates/${id}/submit`, {});
}

// POST /wa-templates/:id/approve → PENDING → APPROVED (sólo ADMIN).
export function approve(id: string) {
  return httpClient.post<WaTemplate>(`/wa-templates/${id}/approve`, {});
}

// POST /wa-templates/:id/reject → PENDING → REJECTED con motivo (sólo ADMIN).
export function reject(id: string, reason: string) {
  return httpClient.post<WaTemplate>(`/wa-templates/${id}/reject`, { reason });
}

// DELETE /wa-templates/:id → 204.
export function remove(id: string) {
  return httpClient.delete<void>(`/wa-templates/${id}`);
}
