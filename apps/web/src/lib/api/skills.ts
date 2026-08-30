import { httpClient } from './http-client';

export interface SkillData {
  name: string;
  subtitle: string;
  description: string;
  iconName: string;
  isActive: boolean;
}

export function getSkills() {
  return httpClient.get<SkillData[]>('/skills');
}

export function updateSkill(name: string, data: Partial<SkillData>) {
  return httpClient.put<SkillData>(`/skills/${encodeURIComponent(name)}`, data);
}
