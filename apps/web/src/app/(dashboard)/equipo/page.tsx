'use client';

import { useState } from 'react';
import { UserPlus, Shield, MoreVertical, Mail, Clock } from 'lucide-react';
import { MOCK_TEAM_MEMBERS, ROLE_CONFIG, type TeamRole } from '@/constants/team';
import { SearchInput } from '@/components/ui/SearchInput';
import { StatusBadge } from '@/components/ui/StatusBadge';

export default function EquipoPage() {
  const [search, setSearch] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<TeamRole>('Profesional');

  const filtered = MOCK_TEAM_MEMBERS.filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.email.toLowerCase().includes(search.toLowerCase()),
  );

  const steps = [
    {
      number: '01',
      title: 'Invitas con un link',
      description: 'Nombre, correo y rol. Te da un link de 7 días, un solo uso. Lo mandas por WhatsApp.',
    },
    {
      number: '02',
      title: 'La persona se crea su acceso',
      description: 'Abre el link, elige su contraseña y llena su perfil: WhatsApp, puesto, horario.',
    },
    {
      number: '03',
      title: 'Tú decides qué ve cada rol',
      description: 'Administrador ve todo. Equipo solo opera — y tú marcas qué secciones abre.',
    },
  ];

  return (
    <div className="space-y-8">
      <p className="text-sm text-slate-400 max-w-2xl">
        Entrega el panel a tu cliente <strong className="text-white">sin darle tu contraseña</strong>.
        El jefe entra con su correo, invita a su gente y decide qué ven. Tú sigues entrando
        igual (admin + tu contraseña) y ves quién hizo qué.
      </p>

      {/* How it works */}
      <div>
        <p className="mono-label mb-2">CÓMO FUNCIONA</p>
        <h3 className="text-lg font-bold text-white mb-4">Una llave maestra, y llaves personales para cada quien</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {steps.map((step) => (
            <div key={step.number} className="card-accent relative">
              <span className="absolute top-4 right-4 text-2xl font-bold text-slate-700">{step.number}</span>
              <h4 className="font-semibold text-white mb-2">{step.title}</h4>
              <p className="text-sm text-slate-400">{step.description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Team members header */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="mono-label">MIEMBROS DEL EQUIPO</h3>
          <div className="flex items-center gap-3">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Buscar miembro..."
              className="max-w-[220px]"
            />
            <button
              onClick={() => setShowInvite(!showInvite)}
              className="btn-primary text-xs"
            >
              <UserPlus className="h-3.5 w-3.5" /> Invitar miembro
            </button>
          </div>
        </div>

        {/* Invite form */}
        {showInvite && (
          <div className="card-accent mb-4">
            <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-brand-400" />
              Enviar invitación
            </h4>
            <div className="flex flex-col sm:flex-row items-start sm:items-end gap-3">
              <div className="flex-1 w-full">
                <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Email</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="correo@ejemplo.com"
                  className="input w-full"
                />
              </div>
              <div className="w-full sm:w-48">
                <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Rol</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as TeamRole)}
                  className="input w-full"
                >
                  <option value="Admin">Admin</option>
                  <option value="Profesional">Profesional</option>
                  <option value="Viewer">Viewer</option>
                </select>
              </div>
              <button className="btn-primary text-xs whitespace-nowrap">
                <Mail className="h-3.5 w-3.5" /> Enviar invitación
              </button>
            </div>
          </div>
        )}

        {/* Team members list */}
        <div className="space-y-2">
          {filtered.map((member) => {
            const roleConfig = ROLE_CONFIG[member.role];
            return (
              <div key={member.id} className="card flex items-center gap-4">
                {/* Avatar */}
                <div className="h-10 w-10 rounded-full bg-brand-400/20 flex items-center justify-center text-sm font-bold text-brand-400 shrink-0">
                  {member.name.split(' ').map((n) => n[0]).join('')}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-white truncate">{member.name}</p>
                    {member.status === 'pending' && (
                      <StatusBadge variant="warning">PENDIENTE</StatusBadge>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 truncate flex items-center gap-1">
                    <Mail className="h-3 w-3" />
                    {member.email}
                  </p>
                </div>

                {/* Role badge */}
                <span className={`badge border text-[9px] ${roleConfig.class}`}>
                  {roleConfig.label}
                </span>

                {/* Join date */}
                <span className="text-[10px] text-slate-500 hidden sm:flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {new Date(member.joinedAt).toLocaleDateString('es-AR', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </span>

                {/* Actions */}
                <button className="text-slate-500 hover:text-white transition-colors p-1">
                  <MoreVertical className="h-4 w-4" />
                </button>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="text-center py-8">
              <p className="text-sm text-slate-500">No se encontraron miembros</p>
            </div>
          )}
        </div>
      </div>

      {/* Security note */}
      <div className="card p-4">
        <p className="text-xs text-slate-500 flex items-center gap-2">
          <Shield className="h-3.5 w-3.5" />
          Recuperar contraseña · Bitácora · Asignar conversaciones · Seguridad —
          5 intentos fallidos = 15 min de bloqueo. Bitácora de quién hizo qué.
        </p>
      </div>
    </div>
  );
}
