'use client';

import { useState, useEffect, useRef } from 'react';
import { UserPlus, Shield, MoreVertical, Mail, Clock, Users, Trash2, Check, SlidersHorizontal, X, RotateCcw, Lock, Send } from 'lucide-react';
import { useTeam } from '@/hooks/use-team';
import { teamApi } from '@/lib/api/index';
import { usePermissions } from '@/hooks/use-permissions';
import { minTierForCapability, PLAN_LABELS } from '@/constants/permissions';
import { ROLE_CONFIG, ROLE_TO_ENUM, type TeamRole, type TeamMember } from '@/constants/team';
import { useToast } from '@/components/common/Toast';
import { SearchInput } from '@/components/ui/SearchInput';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { usePageCounter, fmtCounter } from '@/stores/page-counter';

const ALL_ROLES: TeamRole[] = ['Admin', 'Profesional', 'Viewer'];

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function EquipoPage() {
  const { toast } = useToast();
  const { members, isLoading, error, refetch, updateMember, removeMember } = useTeam();
  const perms = usePermissions();
  // Referencia de "ahora" fija por montaje (para marcar invitaciones vencidas sin llamar Date.now() en el render).
  const [now] = useState(() => Date.now());
  const [search, setSearch] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<TeamRole>('Profesional');
  const [inviting, setInviting] = useState(false);

  // Menú por fila (cambiar rol / quitar) — antes el kebab no hacía nada.
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [toRemove, setToRemove] = useState<TeamMember | null>(null);
  const [removing, setRemoving] = useState(false);
  // Reenviar invitación (el link anterior deja de servir, por eso se confirma).
  const [toResend, setToResend] = useState<TeamMember | null>(null);
  const [resending, setResending] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Modal de permisos granulares por miembro.
  const [permMember, setPermMember] = useState<TeamMember | null>(null);
  const [permDraft, setPermDraft] = useState<string[]>([]);
  const [permSaving, setPermSaving] = useState(false);

  usePageCounter(isLoading ? null : fmtCounter(members.length, 'MIEMBRO', 'MIEMBROS'));

  // Cerrar el menú al hacer clic fuera.
  useEffect(() => {
    if (!openMenuId) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenuId(null);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [openMenuId]);

  const filtered = members.filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.email.toLowerCase().includes(search.toLowerCase()),
  );

  const handleInvite = async () => {
    if (!inviteEmail) return;
    setInviting(true);
    try {
      const email = inviteEmail.trim();
      const res = await teamApi.inviteMember({ email, role: ROLE_TO_ENUM[inviteRole] });
      setInviteEmail('');
      setShowInvite(false);
      refetch();
      // Honesto: si el mail no salió (proveedor sin configurar, etc.) lo decimos.
      toast(
        res.emailSent
          ? { type: 'success', message: `Invitación enviada a ${email}` }
          : {
              type: 'error',
              message: `Creamos la invitación para ${email}, pero no pudimos enviar el mail. Probá con "Reenviar invitación" más tarde.`,
            },
      );
    } catch (err) {
      toast({ type: 'error', message: err instanceof Error ? err.message : 'No se pudo invitar al miembro' });
    }
    finally { setInviting(false); }
  };

  const handleResend = async () => {
    if (!toResend) return;
    setResending(true);
    try {
      const res = await teamApi.resendInvite(toResend.id);
      refetch();
      toast(
        res.emailSent
          ? { type: 'success', message: `Invitación reenviada a ${toResend.email}. El link anterior ya no sirve.` }
          : { type: 'error', message: `No pudimos enviar el mail a ${toResend.email}. Probá de nuevo más tarde.` },
      );
      setToResend(null);
    } catch (err) {
      toast({ type: 'error', message: err instanceof Error ? err.message : 'No se pudo reenviar la invitación' });
    } finally {
      setResending(false);
    }
  };

  const handleChangeRole = async (member: TeamMember, role: TeamRole) => {
    setOpenMenuId(null);
    if (member.role === role) return;
    setUpdatingId(member.id);
    try {
      await updateMember(member.id, { role: ROLE_TO_ENUM[role] });
      toast({ type: 'success', message: `Rol de ${member.name} actualizado a ${role}` });
    } catch (err) {
      toast({ type: 'error', message: err instanceof Error ? err.message : 'No se pudo cambiar el rol' });
    } finally {
      setUpdatingId(null);
    }
  };

  const handleRemove = async () => {
    if (!toRemove) return;
    setRemoving(true);
    try {
      await removeMember(toRemove.id);
      toast({
        type: 'success',
        message: toRemove.status === 'pending' ? 'Invitación revocada' : 'Miembro quitado del equipo',
      });
      setToRemove(null);
    } catch (err) {
      toast({ type: 'error', message: err instanceof Error ? err.message : toRemove.status === 'pending' ? 'No se pudo revocar la invitación' : 'No se pudo quitar al miembro' });
    } finally {
      setRemoving(false);
    }
  };

  const isAdminMember = permMember?.role === 'Admin';

  const openPermissions = (member: TeamMember) => {
    setOpenMenuId(null);
    setPermDraft(perms.capabilitiesFor(member.id, ROLE_TO_ENUM[member.role]));
    setPermMember(member);
  };

  const toggleCap = (key: string) => {
    setPermDraft((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const handleSavePermissions = async () => {
    if (!permMember) return;
    setPermSaving(true);
    try {
      await perms.save(permMember.id, permDraft);
      toast({ type: 'success', message: `Permisos de ${permMember.name} actualizados` });
      setPermMember(null);
    } catch (err) {
      toast({ type: 'error', message: err instanceof Error ? err.message : 'No se pudieron guardar los permisos' });
    } finally {
      setPermSaving(false);
    }
  };

  const handleResetPermissions = async () => {
    if (!permMember) return;
    setPermSaving(true);
    try {
      await perms.reset(permMember.id);
      toast({ type: 'success', message: `Permisos de ${permMember.name} restablecidos al rol` });
      setPermMember(null);
    } catch (err) {
      toast({ type: 'error', message: err instanceof Error ? err.message : 'No se pudo restablecer' });
    } finally {
      setPermSaving(false);
    }
  };

  const steps = [
    { number: '01', title: 'Invitás por correo', description: 'Le mandamos un link de un solo uso (vence en 7 días) para que elija su contraseña. Mientras no lo acepte figura como pendiente.' },
    { number: '02', title: 'Le asignás un rol', description: 'Según lo que tenga que hacer. Podés cambiarlo cuando quieras desde el menú del miembro; si cambia, tiene que volver a iniciar sesión.' },
    { number: '03', title: 'Tú decides qué ve cada rol', description: 'Administrador ve todo. Equipo solo opera — y tú marcas qué secciones abre.' },
  ];

  if (isLoading) return <LoadingSpinner label="Cargando equipo..." />;

  return (
    <div className="space-y-8">
      {error && <ErrorAlert message={error} onRetry={refetch} />}

      <p className="text-sm text-slate-400 max-w-2xl">
        Entrega el panel a tu cliente <strong className="text-white">sin darle tu contraseña</strong>.
        El jefe entra con su correo, invita a su gente y decide qué ven. Tú sigues entrando
        igual (admin + tu contraseña) y ves quién hizo qué.
      </p>

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

      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="mono-label">MIEMBROS DEL EQUIPO</h3>
          <div className="flex items-center gap-3">
            <SearchInput value={search} onChange={setSearch} placeholder="Buscar miembro..." className="max-w-[220px]" />
            <button onClick={() => setShowInvite(!showInvite)} className="btn-primary text-xs">
              <UserPlus className="h-3.5 w-3.5" /> Invitar miembro
            </button>
          </div>
        </div>

        {showInvite && (
          <div className="card-accent mb-4">
            <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-brand-400" /> Invitar miembro
            </h4>
            <div className="flex flex-col sm:flex-row items-start sm:items-end gap-3">
              <div className="flex-1 w-full">
                <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Email</label>
                <input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="correo@ejemplo.com" className="input w-full" />
              </div>
              <div className="w-full sm:w-48">
                <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Rol</label>
                <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as TeamRole)} className="input w-full">
                  <option value="Admin">Admin</option>
                  <option value="Profesional">Profesional</option>
                  <option value="Viewer">Viewer</option>
                </select>
              </div>
              <button onClick={handleInvite} disabled={inviting || !inviteEmail} className="btn-primary text-xs whitespace-nowrap disabled:opacity-50">
                <Mail className="h-3.5 w-3.5" /> {inviting ? 'Enviando...' : 'Enviar invitación'}
              </button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {filtered.map((member) => {
            const roleConfig = ROLE_CONFIG[member.role];
            const caps = perms.effectiveFor(member.id, ROLE_TO_ENUM[member.role]);
            const customPerms = perms.hasOverride(member.id);
            return (
              <div key={member.id} className="card flex items-center gap-4">
                <div className="h-10 w-10 rounded-full bg-brand-400/20 flex items-center justify-center text-sm font-bold text-brand-400 shrink-0">
                  {member.name.split(' ').map((n) => n[0]).join('')}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-white truncate">{member.name}</p>
                    {member.status === 'pending'
                      ? <StatusBadge variant="warning">PENDIENTE</StatusBadge>
                      : <StatusBadge variant="active">ACTIVO</StatusBadge>}
                  </div>
                  <p className="text-xs text-slate-500 truncate flex items-center gap-1"><Mail className="h-3 w-3" />{member.email}</p>
                  {member.status === 'pending' && (
                    <p className="text-[10px] text-yellow-400/80 truncate">
                      {member.inviteExpiresAt && new Date(member.inviteExpiresAt).getTime() <= now
                        ? `La invitación a ${member.email} venció. Reenviá una nueva.`
                        : member.inviteExpiresAt
                          ? `Invitación enviada a ${member.email} · vence el ${fmtDate(member.inviteExpiresAt)}`
                          : `Invitación pendiente de ${member.email}. Reenviala si no le llegó.`}
                    </p>
                  )}
                  {!perms.isLoading && (
                    <button
                      onClick={() => openPermissions(member)}
                      className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-500 hover:text-brand-400 transition-colors"
                      title="Gestionar permisos y herramientas"
                    >
                      <SlidersHorizontal className="h-2.5 w-2.5" />
                      {member.role === 'Admin' ? 'Acceso total' : `${caps.length} ${caps.length === 1 ? 'herramienta' : 'herramientas'}`}
                      {customPerms && member.role !== 'Admin' && <span className="text-brand-400">· personalizado</span>}
                    </button>
                  )}
                </div>
                {member.status === 'pending' && (
                  <button
                    onClick={() => setToResend(member)}
                    className="hidden sm:flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-[10px] text-slate-300 hover:border-brand-400/40 hover:text-white transition-colors"
                    title="Reenviar invitación"
                  >
                    <Send className="h-3 w-3" /> Reenviar
                  </button>
                )}
                <span className={`badge border text-[9px] ${roleConfig?.class || ''}`}>{roleConfig?.label || member.role}</span>
                <span className="text-[10px] text-slate-500 hidden sm:flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {fmtDate(member.joinedAt)}
                </span>
                <div className="relative" ref={openMenuId === member.id ? menuRef : undefined}>
                  <button
                    onClick={() => setOpenMenuId(openMenuId === member.id ? null : member.id)}
                    disabled={updatingId === member.id}
                    className="text-slate-500 hover:text-white transition-colors p-1 disabled:opacity-50"
                    title="Acciones"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                  {openMenuId === member.id && (
                    <div className="absolute right-0 top-full mt-1 z-20 w-48 rounded-lg border border-slate-700 bg-slate-900 shadow-xl py-1">
                      <p className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-500">Cambiar rol</p>
                      {ALL_ROLES.map((r) => (
                        <button
                          key={r}
                          onClick={() => handleChangeRole(member, r)}
                          className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-slate-300 hover:bg-surface-100 hover:text-white transition-colors"
                        >
                          {ROLE_CONFIG[r].label}
                          {member.role === r && <Check className="h-3.5 w-3.5 text-brand-400" />}
                        </button>
                      ))}
                      <div className="my-1 border-t border-slate-700/50" />
                      <button
                        onClick={() => openPermissions(member)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-300 hover:bg-surface-100 hover:text-white transition-colors"
                      >
                        <SlidersHorizontal className="h-3.5 w-3.5 text-brand-400" /> Permisos y herramientas
                      </button>
                      <div className="my-1 border-t border-slate-700/50" />
                      {member.status === 'pending' && (
                        <button
                          onClick={() => { setOpenMenuId(null); setToResend(member); }}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-300 hover:bg-surface-100 hover:text-white transition-colors"
                        >
                          <Send className="h-3.5 w-3.5 text-brand-400" /> Reenviar invitación
                        </button>
                      )}
                      <button
                        onClick={() => { setOpenMenuId(null); setToRemove(member); }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> {member.status === 'pending' ? 'Revocar invitación' : 'Quitar del equipo'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <EmptyState icon={Users} title="Sin resultados" description="No se encontraron miembros con esa búsqueda" />
          )}
        </div>
      </div>

      <div className="card p-4">
        <p className="text-xs text-slate-500 flex items-center gap-2">
          <Shield className="h-3.5 w-3.5" />
          Seguridad: 5 intentos fallidos de inicio de sesión bloquean la cuenta por 15 minutos.
        </p>
      </div>

      {permMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => !permSaving && setPermMember(null)}>
          <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 border-b border-slate-700/50 p-5">
              <div className="min-w-0">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4 text-brand-400" /> Permisos de {permMember.name}
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  Elegí qué herramientas puede abrir en el panel. Se guarda por persona.
                </p>
              </div>
              <button onClick={() => !permSaving && setPermMember(null)} className="text-slate-500 hover:text-white transition-colors shrink-0">
                <X className="h-4 w-4" />
              </button>
            </div>

            {isAdminMember ? (
              <div className="p-5">
                <div className="rounded-lg border border-brand-400/20 bg-brand-400/5 p-4 flex items-start gap-3">
                  <Shield className="h-4 w-4 text-brand-400 mt-0.5 shrink-0" />
                  <p className="text-xs text-slate-300">
                    Los <strong className="text-white">administradores tienen acceso total</strong> a todas las
                    herramientas. Para limitar a alguien, cambiale el rol a <strong className="text-white">Profesional</strong> o
                    <strong className="text-white"> Viewer</strong> y después ajustá sus permisos acá.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="px-5 pt-4">
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-700/50 bg-surface-100 px-3 py-2">
                    <span className="text-[11px] text-slate-400">
                      Plan del negocio: <strong className="text-white">{perms.planLabel}</strong>
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {perms.planCapabilities.length} de {perms.catalog.length} herramientas disponibles
                    </span>
                  </div>
                </div>
                <div className="max-h-[46vh] overflow-y-auto p-5 space-y-2">
                  {perms.catalog.map((cap) => {
                    const inPlan = perms.isInPlan(cap.key);
                    const checked = permDraft.includes(cap.key);
                    if (!inPlan) {
                      const reqTier = minTierForCapability(cap.key);
                      return (
                        <div
                          key={cap.key}
                          className="flex items-start gap-3 rounded-lg border border-dashed border-slate-700/50 bg-surface-100/40 p-3 opacity-80"
                          title="Esta herramienta no está incluida en el plan actual"
                        >
                          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-slate-300">{cap.label}</p>
                            <p className="text-xs text-slate-500">{cap.description}</p>
                          </div>
                          {reqTier && (
                            <span className="shrink-0 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[9px] font-mono uppercase tracking-wider text-amber-400">
                              {PLAN_LABELS[reqTier]}
                            </span>
                          )}
                        </div>
                      );
                    }
                    return (
                      <label
                        key={cap.key}
                        className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                          checked ? 'border-brand-400/40 bg-brand-400/5' : 'border-slate-700/50 hover:border-slate-600'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleCap(cap.key)}
                          className="mt-0.5 h-4 w-4 shrink-0 accent-brand-400"
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-white">{cap.label}</p>
                          <p className="text-xs text-slate-500">{cap.description}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-slate-700/50 p-4">
                  <button
                    onClick={handleResetPermissions}
                    disabled={permSaving}
                    className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors disabled:opacity-50"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Restablecer al rol
                  </button>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-500">
                      {permDraft.filter((k) => perms.isInPlan(k)).length} de {perms.planCapabilities.length} del plan
                    </span>
                    <button onClick={() => setPermMember(null)} disabled={permSaving} className="btn-secondary text-xs disabled:opacity-50">
                      Cancelar
                    </button>
                    <button onClick={handleSavePermissions} disabled={permSaving} className="btn-primary text-xs disabled:opacity-50">
                      {permSaving ? 'Guardando...' : 'Guardar permisos'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={toRemove !== null}
        onClose={() => setToRemove(null)}
        onConfirm={handleRemove}
        title={toRemove?.status === 'pending' ? 'Revocar invitación' : 'Quitar del equipo'}
        message={
          toRemove
            ? toRemove.status === 'pending'
              ? `¿Revocar la invitación a ${toRemove.email}? El link que le mandamos deja de funcionar y se borra de la lista.`
              : `¿Seguro que querés quitar a ${toRemove.name} del equipo? Perderá el acceso al panel y se le cerrarán las sesiones abiertas.`
            : ''
        }
        confirmLabel={toRemove?.status === 'pending' ? 'Revocar' : 'Quitar'}
        variant="danger"
        loading={removing}
      />

      <ConfirmDialog
        isOpen={toResend !== null}
        onClose={() => setToResend(null)}
        onConfirm={handleResend}
        title="Reenviar invitación"
        message={toResend ? `Vamos a mandar un mail nuevo a ${toResend.email}. El link anterior deja de funcionar y el nuevo vence en 7 días.` : ''}
        confirmLabel="Reenviar"
        variant="default"
        loading={resending}
      />
    </div>
  );
}
