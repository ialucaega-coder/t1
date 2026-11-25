import { httpClient } from './http-client';

// Cliente del panel del Super Admin (dueño de la plataforma). Pega contra
// /api/platform/*, que en el backend va detrás de requireAuth + requirePlatformAdmin
// (allowlist por email de PLATFORM_ADMIN_EMAILS). Un usuario no autorizado recibe
// 403 y la página lo muestra como "sin acceso".

export type PlanTier = 'FREE' | 'STARTER' | 'PRO' | 'ENTERPRISE';

export interface PlatformBusiness {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  createdAt: string;
  planTier: PlanTier | null;
  planName: string | null;
  subscriptionStatus: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  usersCount: number;
  botsCount: number;
}

export interface PlatformBusinessesResponse {
  businesses: PlatformBusiness[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PlatformFeatureFlag {
  key: string;
  label: string;
  description: string;
}

export interface FeaturesResponse {
  catalog: PlatformFeatureFlag[];
  flags: Record<string, boolean>;
}

export interface ListBusinessesParams {
  page?: number;
  pageSize?: number;
  search?: string;
}

export function listBusinesses(params: ListBusinessesParams = {}) {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', String(params.page));
  if (params.pageSize) qs.set('pageSize', String(params.pageSize));
  if (params.search) qs.set('search', params.search);
  const query = qs.toString();
  return httpClient.get<PlatformBusinessesResponse>(`/platform/businesses${query ? `?${query}` : ''}`);
}

export function setBusinessActive(id: string, isActive: boolean) {
  return httpClient.patch<{ id: string; name: string; slug: string; isActive: boolean }>(
    `/platform/businesses/${id}/active`,
    { isActive },
  );
}

export function setBusinessPlan(id: string, tier: PlanTier) {
  return httpClient.patch<{
    businessId: string;
    planTier: PlanTier;
    planName: string;
    status: string;
    cancelAtPeriodEnd: boolean;
  }>(`/platform/businesses/${id}/plan`, { tier });
}

export function getBusinessFeatures(id: string) {
  return httpClient.get<FeaturesResponse>(`/platform/businesses/${id}/features`);
}

export function saveBusinessFeatures(id: string, flags: Record<string, boolean>) {
  return httpClient.put<{ businessId: string; flags: Record<string, boolean> }>(
    `/platform/businesses/${id}/features`,
    { flags },
  );
}
