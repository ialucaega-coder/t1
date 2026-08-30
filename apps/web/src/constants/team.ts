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
