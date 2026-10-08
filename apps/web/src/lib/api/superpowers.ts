import { httpClient } from './http-client';

export type SuperpowerParamType = 'number' | 'select' | 'text';

export interface SuperpowerParamSpec {
  key: string;
  label: string;
  help?: string;
  type: SuperpowerParamType;
  default: number | string;
  min?: number;
  max?: number;
  options?: { value: string; label: string }[];
  maxLength?: number;
  placeholder?: string;
}

export type SuperpowerParamValues = Record<string, number | string>;

export interface SuperpowerData {
  name: string;
  subtitle: string;
  description: string;
  iconName: string;
  isActive: boolean;
  params?: SuperpowerParamValues;
  paramSpecs?: SuperpowerParamSpec[];
}

export interface UpdateSuperpowerInput {
  isActive?: boolean;
  params?: SuperpowerParamValues;
}

export function getSuperpowers() {
  return httpClient.get<SuperpowerData[]>('/superpowers');
}

export function updateSuperpower(name: string, data: UpdateSuperpowerInput) {
  return httpClient.put<SuperpowerData>(`/superpowers/${encodeURIComponent(name)}`, data);
}
