export type TeamRole = 'Admin' | 'Profesional' | 'Viewer';

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: TeamRole;
  avatar?: string;
  status: 'active' | 'pending';
  joinedAt: string;
}

export const ROLE_CONFIG: Record<TeamRole, { label: string; class: string }> = {
  Admin: { label: 'ADMIN', class: 'bg-brand-400/10 text-brand-400 border-brand-400/20' },
  Profesional: { label: 'PROFESIONAL', class: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  Viewer: { label: 'VIEWER', class: 'bg-slate-500/10 text-slate-400 border-slate-500/20' },
};

// El backend persiste el rol como enum (ADMIN | PROFESSIONAL | VIEWER), pero la
// UI usa etiquetas en español (Admin | Profesional | Viewer). Estos mapas evitan
// el desajuste que rompía invitar/actualizar (el backend rechaza 'Profesional').
export const ROLE_TO_ENUM: Record<TeamRole, 'ADMIN' | 'PROFESSIONAL' | 'VIEWER'> = {
  Admin: 'ADMIN',
  Profesional: 'PROFESSIONAL',
  Viewer: 'VIEWER',
};

const ENUM_TO_ROLE: Record<string, TeamRole> = {
  ADMIN: 'Admin',
  PROFESSIONAL: 'Profesional',
  VIEWER: 'Viewer',
  // Tolerar valores que ya vengan en formato display.
  Admin: 'Admin',
  Profesional: 'Profesional',
  Viewer: 'Viewer',
};

// Normaliza cualquier representación de rol (enum del backend o display) a la
// etiqueta de UI; cae a 'Viewer' ante un valor desconocido.
export function normalizeRole(role: string): TeamRole {
  return ENUM_TO_ROLE[role] ?? 'Viewer';
}

export const MOCK_TEAM_MEMBERS: TeamMember[] = [
  {
    id: '1',
    name: 'Luca Anzotegui',
    email: 'luca@localb.app',
    role: 'Admin',
    status: 'active',
    joinedAt: '2024-01-15',
  },
  {
    id: '2',
    name: 'María García',
    email: 'maria@localb.app',
    role: 'Profesional',
    status: 'active',
    joinedAt: '2024-03-22',
  },
  {
    id: '3',
    name: 'Carlos López',
    email: 'carlos@localb.app',
    role: 'Profesional',
    status: 'active',
    joinedAt: '2024-05-10',
  },
  {
    id: '4',
    name: 'Ana Rodríguez',
    email: 'ana@localb.app',
    role: 'Viewer',
    status: 'pending',
    joinedAt: '2024-08-01',
  },
];
