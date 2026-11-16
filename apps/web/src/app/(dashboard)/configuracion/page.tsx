'use client';

import { FormEvent, useEffect, useState, useCallback } from 'react';
import { Save, Palette, Globe, Clock, Plus, Trash2, UserCog, Lock, CheckCircle, ShieldCheck, KeyRound } from 'lucide-react';
import { useSettings } from '@/hooks/use-settings';
import { useAuth } from '@/lib/auth-context';
import { THEME_OPTIONS } from '@/constants/settings';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import * as schedulesApi from '@/lib/api/schedules';
import * as authApi from '@/lib/api/auth';
import { useToast } from '@/components/common/Toast';
import { MotorDeIA } from '@/app/(dashboard)/ia/MotorDeIA';
import { RecoveryCodesPanel } from '@/components/auth/RecoveryCodesPanel';
import type { Schedule } from '@/types';
import type { BusinessSettings } from '@/lib/api/settings';

const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

// Segundo factor aceptado al desactivar o rearmar el 2FA: código de 6 dígitos de
// la app o código de recuperación (10 caracteres, con o sin guion).
const isSecondFactorCode = (v: string) => /^(\d{6}|[A-Za-z0-9]{5}-?[A-Za-z0-9]{5})$/.test(v.trim());

const errorMessage = (err: unknown, fallback: string) =>
  err instanceof Error && err.message ? err.message : fallback;

export default function ConfiguracionPage() {
  const { settings, isLoading, error, refetch, updateSettings } = useSettings();
  const { user, updateProfile } = useAuth();
  // null hasta que haya datos reales: nunca se editan ni se guardan valores de relleno.
  const [form, setForm] = useState<BusinessSettings | null>(settings);
  const [isSaving, setIsSaving] = useState(false);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  // Borradores de los inputs de hora: se guardan al perder el foco (no en cada cambio).
  const [timeDrafts, setTimeDrafts] = useState<Record<string, string>>({});
  const [loadingSchedules, setLoadingSchedules] = useState(true);
  // Mensaje si no se pudieron cargar los horarios: sin esto la grilla mostraría
  // todos los días "Cerrado" como si fuera real.
  const [schedulesError, setSchedulesError] = useState<string | null>(null);
  const [profileName, setProfileName] = useState(user?.name || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  // --- Estado 2FA ---
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [twoFactorLoading, setTwoFactorLoading] = useState(true);
  const [twoFactorSetup, setTwoFactorSetup] = useState<{ otpauthUri: string; qrDataUrl: string } | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [twoFactorBusy, setTwoFactorBusy] = useState(false);
  const [disabling, setDisabling] = useState(false);
  // Códigos de recuperación: los que se muestran UNA vez (recién emitidos), cuántos
  // quedan sin usar y si está abierto el form para pedir un juego nuevo.
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [recoveryRemaining, setRecoveryRemaining] = useState<number | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  useEffect(() => {
    if (user?.name) setProfileName(user.name);
  }, [user?.name]);

  async function handleProfileSave() {
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      const data: { name?: string; currentPassword?: string; newPassword?: string } = {};
      if (profileName.trim() !== user?.name) data.name = profileName.trim();
      if (newPassword) {
        data.currentPassword = currentPassword;
        data.newPassword = newPassword;
      }
      if (Object.keys(data).length === 0) {
        setProfileMsg({ type: 'error', text: 'No hay cambios para guardar' });
        setProfileSaving(false);
        return;
      }
      await updateProfile(data);
      setCurrentPassword('');
      setNewPassword('');
      setProfileMsg({ type: 'success', text: 'Perfil actualizado correctamente' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al actualizar perfil';
      setProfileMsg({ type: 'error', text: msg });
    } finally {
      setProfileSaving(false);
    }
  }

  const fetchSchedules = useCallback(async () => {
    setLoadingSchedules(true);
    try {
      const data = await schedulesApi.getSchedules();
      setSchedules(data);
      setSchedulesError(null);
    } catch (err) {
      setSchedulesError(errorMessage(err, 'No se pudieron cargar los horarios'));
    } finally {
      setLoadingSchedules(false);
    }
  }, []);

  useEffect(() => { fetchSchedules(); }, [fetchSchedules]);

  // Lee el estado del 2FA al montar.
  useEffect(() => {
    let active = true;
    authApi.getTwoFactorStatus()
      .then((res) => {
        if (!active) return;
        setTwoFactorEnabled(res.enabled);
        setRecoveryRemaining(res.enabled ? res.recoveryCodesRemaining ?? 0 : null);
      })
      .catch(() => { /* ignore: queda como desactivado */ })
      .finally(() => { if (active) setTwoFactorLoading(false); });
    return () => { active = false; };
  }, []);

  // Inicia el alta: pide el QR y el otpauth URI al backend.
  async function handleStartTwoFactorSetup() {
    setTwoFactorBusy(true);
    try {
      const data = await authApi.setupTwoFactor();
      setTwoFactorSetup(data);
      setTwoFactorCode('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo iniciar la configuración de 2FA';
      toast({ type: 'error', message: msg });
    } finally {
      setTwoFactorBusy(false);
    }
  }

  // Verifica el código de 6 dígitos y activa el 2FA.
  async function handleVerifyTwoFactor() {
    if (twoFactorCode.length !== 6) return;
    setTwoFactorBusy(true);
    try {
      const res = await authApi.verifyTwoFactor(twoFactorCode);
      setTwoFactorEnabled(true);
      setTwoFactorSetup(null);
      setTwoFactorCode('');
      setRecoveryCodes(res.recoveryCodes);
      setRecoveryRemaining(res.recoveryCodes.length);
      toast({ type: 'success', message: 'Autenticación en dos pasos activada' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Código inválido';
      toast({ type: 'error', message: msg });
    } finally {
      setTwoFactorBusy(false);
    }
  }

  // Cancela el alta en curso sin activar.
  function handleCancelTwoFactorSetup() {
    setTwoFactorSetup(null);
    setTwoFactorCode('');
  }

  // Desactiva el 2FA pidiendo un código válido (de la app o de recuperación).
  async function handleDisableTwoFactor() {
    if (!isSecondFactorCode(twoFactorCode)) return;
    setTwoFactorBusy(true);
    try {
      await authApi.disableTwoFactor(twoFactorCode);
      setTwoFactorEnabled(false);
      setDisabling(false);
      setTwoFactorCode('');
      setRecoveryCodes(null);
      setRecoveryRemaining(null);
      toast({ type: 'success', message: 'Autenticación en dos pasos desactivada' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Código inválido';
      toast({ type: 'error', message: msg });
    } finally {
      setTwoFactorBusy(false);
    }
  }

  // Pide un juego nuevo de códigos de recuperación (los anteriores dejan de servir).
  async function handleRegenerateRecoveryCodes() {
    if (!isSecondFactorCode(twoFactorCode)) return;
    setTwoFactorBusy(true);
    try {
      const res = await authApi.regenerateRecoveryCodes(twoFactorCode);
      setRecoveryCodes(res.recoveryCodes);
      setRecoveryRemaining(res.recoveryCodes.length);
      setRegenerating(false);
      setTwoFactorCode('');
      toast({ type: 'success', message: 'Códigos de recuperación nuevos generados' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Código inválido';
      toast({ type: 'error', message: msg });
    } finally {
      setTwoFactorBusy(false);
    }
  }

  async function handleToggleDay(schedule: Schedule) {
    try {
      const updated = await schedulesApi.updateSchedule(schedule.id, { isActive: !schedule.isActive });
      setSchedules((prev) => prev.map((s) => (s.id === schedule.id ? updated : s)));
    } catch (err) {
      toast({ type: 'error', message: errorMessage(err, 'No se pudo actualizar el horario') });
    }
  }

  async function handleUpdateTime(schedule: Schedule, field: 'startTime' | 'endTime', value: string) {
    try {
      const updated = await schedulesApi.updateSchedule(schedule.id, { [field]: value });
      setSchedules((prev) => prev.map((s) => (s.id === schedule.id ? updated : s)));
    } catch (err) {
      toast({ type: 'error', message: errorMessage(err, 'No se pudo guardar el horario') });
    }
  }

  const draftKey = (schedule: Schedule, field: 'startTime' | 'endTime') => `${schedule.id}:${field}`;

  // Al perder el foco se persiste el borrador (un solo PUT) y se descarta, así el
  // input vuelve a mostrar el valor del servidor, también si el guardado falla.
  async function handleTimeBlur(schedule: Schedule, field: 'startTime' | 'endTime') {
    const key = draftKey(schedule, field);
    const draft = timeDrafts[key];
    if (draft === undefined) return;
    setTimeDrafts((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    if (!draft || draft === schedule[field]) return;
    await handleUpdateTime(schedule, field, draft);
  }

  async function handleDeleteSchedule(id: string) {
    try {
      await schedulesApi.deleteSchedule(id);
      setSchedules((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      toast({ type: 'error', message: errorMessage(err, 'No se pudo eliminar el horario') });
    }
  }

  async function handleAddSchedule(dayOfWeek: number) {
    try {
      const created = await schedulesApi.createSchedule({
        dayOfWeek,
        startTime: '09:00',
        endTime: '18:00',
        isActive: true,
      });
      setSchedules((prev) => [...prev, created]);
    } catch (err) {
      toast({ type: 'error', message: errorMessage(err, 'No se pudo agregar el horario') });
    }
  }

  const updateField = (field: keyof BusinessSettings, value: string) => {
    setForm((current) => (current ? { ...current, [field]: value } : current));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form) return;
    setIsSaving(true);
    try {
      await updateSettings(form);
      toast({ type: 'success', message: 'Configuración guardada correctamente' });
    } catch (err) {
      toast({ type: 'error', message: errorMessage(err, 'Error al guardar configuración') });
    } finally {
      setIsSaving(false);
    }
  };

  // Spinner de página completa solo en la carga inicial. En un reintento tras error
  // (`error` sigue seteado hasta que cargue bien) o con datos ya cargados se
  // mantiene la pantalla, así no se desmonta el formulario ni parpadea.
  if (isLoading && !settings && !error) {
    return <LoadingSpinner label="Cargando configuración..." />;
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-3xl space-y-8">
      {error && form && <ErrorAlert message={error} onRetry={refetch} />}

      <section className="card">
        <div className="flex items-center gap-3 mb-4">
          <UserCog className="h-5 w-5 text-brand-400" />
          <h3 className="font-semibold text-white">Mi perfil</h3>
        </div>
        {profileMsg && (
          <div className={`mb-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
            profileMsg.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
              : 'bg-red-500/10 border-red-500/20 text-red-400'
          }`}>
            {profileMsg.type === 'success' && <CheckCircle className="h-3.5 w-3.5" />}
            {profileMsg.text}
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Nombre</label>
            <input className="input" value={profileName} onChange={(e) => setProfileName(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Email</label>
            <input className="input opacity-50 cursor-not-allowed" value={user?.email || ''} disabled />
          </div>
        </div>
        <div className="mt-4">
          <div className="flex items-center gap-2 mb-3">
            <Lock className="h-4 w-4 text-slate-500" />
            <p className="text-xs text-slate-400">Cambiar contraseña (opcional)</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Contraseña actual</label>
              <input type="password" className="input" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="••••••••" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Nueva contraseña</label>
              <input type="password" className="input" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Mínimo 6 caracteres" />
            </div>
          </div>
        </div>
        <div className="flex justify-end mt-4">
          <button type="button" onClick={handleProfileSave} disabled={profileSaving}
            className="btn-primary text-xs">
            <Save className="h-3.5 w-3.5" /> {profileSaving ? 'Guardando...' : 'Actualizar perfil'}
          </button>
        </div>
      </section>

      <section className="card">
        <div className="flex items-center gap-3 mb-4">
          <ShieldCheck className="h-5 w-5 text-brand-400" />
          <h3 className="font-semibold text-white">Autenticación en dos pasos (2FA)</h3>
          {twoFactorEnabled && <span className="badge-active">ACTIVO</span>}
        </div>
        <p className="text-sm text-slate-400 mb-4">
          Agregá una capa extra de seguridad: al iniciar sesión te pediremos un código de tu app de
          autenticación (Google Authenticator, Authy, etc.).
        </p>

        {twoFactorLoading ? (
          <LoadingSpinner label="Cargando estado de 2FA..." />
        ) : twoFactorEnabled ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400">
              <CheckCircle className="h-3.5 w-3.5" />
              La autenticación en dos pasos está activa en tu cuenta.
            </div>
            {recoveryCodes ? (
              <RecoveryCodesPanel codes={recoveryCodes} onDone={() => setRecoveryCodes(null)} />
            ) : (
              <p className={`text-xs ${recoveryRemaining !== null && recoveryRemaining <= 2 ? 'text-amber-400' : 'text-slate-400'}`}>
                Códigos de recuperación sin usar: <strong>{recoveryRemaining ?? 0}</strong>
                {recoveryRemaining !== null && recoveryRemaining <= 2 && ' — generá un juego nuevo para no quedarte sin acceso.'}
              </p>
            )}
            {!disabling && !regenerating ? (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => { setRegenerating(true); setTwoFactorCode(''); }}
                  className="btn-secondary text-xs">
                  <KeyRound className="h-3.5 w-3.5" /> Generar códigos nuevos
                </button>
                <button type="button" onClick={() => { setDisabling(true); setTwoFactorCode(''); }}
                  className="btn-secondary text-xs">
                  <Lock className="h-3.5 w-3.5" /> Desactivar 2FA
                </button>
              </div>
            ) : (
              <div className="space-y-3 rounded-lg border border-slate-700/50 bg-slate-800/30 p-4">
                <label htmlFor="two-factor-confirm-code" className="block text-xs text-slate-400">
                  {disabling
                    ? 'Para confirmar la desactivación ingresá el código de 6 dígitos de tu app o un código de recuperación.'
                    : 'Para generar códigos nuevos ingresá el código de 6 dígitos de tu app o un código de recuperación. Los anteriores dejarán de servir.'}
                </label>
                <input
                  id="two-factor-confirm-code"
                  type="text"
                  autoComplete="one-time-code"
                  maxLength={11}
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value.replace(/[^A-Za-z0-9-]/g, '').slice(0, 11))}
                  className="input max-w-[220px] text-center tracking-[0.2em] font-mono"
                  placeholder="000000"
                  autoFocus
                />
                <div className="flex gap-2">
                  <button type="button"
                    onClick={() => { setDisabling(false); setRegenerating(false); setTwoFactorCode(''); }}
                    className="btn-secondary text-xs">
                    Cancelar
                  </button>
                  <button type="button"
                    onClick={disabling ? handleDisableTwoFactor : handleRegenerateRecoveryCodes}
                    disabled={twoFactorBusy || !isSecondFactorCode(twoFactorCode)}
                    className="btn-primary text-xs disabled:opacity-40">
                    {twoFactorBusy
                      ? 'Procesando...'
                      : disabling ? 'Confirmar desactivación' : 'Generar códigos nuevos'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : twoFactorSetup ? (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-4 items-start">
              <div className="rounded-lg border border-slate-700/50 bg-white p-2 shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={twoFactorSetup.qrDataUrl} alt="Código QR para 2FA" className="h-40 w-40" />
              </div>
              <div className="flex-1 min-w-0 space-y-2">
                <p className="text-xs text-slate-400">
                  Escaneá el QR con tu app de autenticación. Si no podés escanear, copiá este código:
                </p>
                <code className="block break-all rounded-lg border border-slate-700/50 bg-slate-800/50 p-2 text-[10px] font-mono text-slate-300">
                  {twoFactorSetup.otpauthUri}
                </code>
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Código de verificación</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={twoFactorCode}
                onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="input max-w-[180px] text-center tracking-[0.4em] font-mono"
                placeholder="000000"
                autoFocus
              />
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={handleCancelTwoFactorSetup} className="btn-secondary text-xs">
                Cancelar
              </button>
              <button type="button" onClick={handleVerifyTwoFactor}
                disabled={twoFactorBusy || twoFactorCode.length !== 6}
                className="btn-primary text-xs disabled:opacity-40">
                <ShieldCheck className="h-3.5 w-3.5" /> {twoFactorBusy ? 'Verificando...' : 'Verificar y activar'}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={handleStartTwoFactorSetup} disabled={twoFactorBusy}
            className="btn-primary text-xs">
            <ShieldCheck className="h-3.5 w-3.5" /> {twoFactorBusy ? 'Generando...' : 'Activar 2FA'}
          </button>
        )}
      </section>

      {form ? (
        <>
        <section className="card">
          <div className="flex items-center gap-3 mb-4">
            <Globe className="h-5 w-5 text-brand-400" />
            <h3 className="font-semibold text-white">Datos del negocio</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Nombre del negocio</label>
              <input className="input" value={form.businessName} onChange={(e) => updateField('businessName', e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Slug (URL)</label>
              <input className="input" value={form.slug} onChange={(e) => updateField('slug', e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Teléfono</label>
              <input className="input" value={form.phone} onChange={(e) => updateField('phone', e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Email</label>
              <input className="input" value={form.email} onChange={(e) => updateField('email', e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-slate-500 mb-1 block">Dirección</label>
              <input className="input" value={form.address} onChange={(e) => updateField('address', e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Zona horaria</label>
              <select className="input" value={form.timezone} onChange={(e) => updateField('timezone', e.target.value)}>
                <option>America/Argentina/Buenos_Aires</option>
                <option>America/Mexico_City</option>
                <option>America/Bogota</option>
                <option>America/Santiago</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Moneda</label>
              <select className="input" value={form.currency} onChange={(e) => updateField('currency', e.target.value)}>
                <option>ARS</option>
                <option>USD</option>
                <option>MXN</option>
                <option>COP</option>
              </select>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="flex items-center gap-3 mb-4">
            <Palette className="h-5 w-5 text-brand-400" />
            <h3 className="font-semibold text-white">White-label</h3>
            <span className="badge-active">ACTIVO</span>
          </div>
          <p className="text-sm text-slate-400 mb-4">
            Tu panel, con tu marca. Ponle a tus bots un panel con tu logo, tu color y uno de tres estilos.
          </p>
          <div className="grid grid-cols-3 gap-3 mb-4">
            {THEME_OPTIONS.map((t) => (
              <button
                key={t.name}
                type="button"
                onClick={() => updateField('theme', t.name.toLowerCase())}
                className={`rounded-lg p-4 border-2 transition-all ${
                  form.theme === t.name.toLowerCase()
                    ? 'border-brand-500'
                    : 'border-slate-700 hover:border-slate-600'
                } ${t.bg}`}
              >
                <p className={`font-semibold ${t.text}`}>{t.name}</p>
                <p className={`text-xs opacity-60 ${t.text}`}>{t.desc}</p>
              </button>
            ))}
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Color de acento</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={form.accentColor}
                onChange={(e) => updateField('accentColor', e.target.value)}
                className="h-10 w-10 rounded border border-slate-700 bg-transparent cursor-pointer"
              />
              <input
                className="input max-w-[120px]"
                value={form.accentColor}
                onChange={(e) => updateField('accentColor', e.target.value)}
              />
            </div>
          </div>
        </section>
        </>
      ) : (
        <section className="card space-y-3">
          <p className="text-sm text-slate-400">
            No pudimos cargar los datos del negocio, por eso no se pueden editar ni guardar por ahora.
          </p>
          <ErrorAlert
            message={isLoading ? 'Reintentando...' : (error ?? 'Error al cargar configuración')}
            onRetry={isLoading ? undefined : refetch}
          />
        </section>
      )}

      <section className="card">
        <p className="text-sm text-slate-400 mb-4">
          Enchufá tu propia cuenta de Claude, ChatGPT, Gemini o Grok como cerebro del bot.
          Elegí el modelo activo y cargá tus API keys; es la misma configuración que vive en
          la sección Motor de IA.
        </p>
        {/* Panel real del Motor de IA (el que el bot efectivamente usa). */}
        <MotorDeIA />
      </section>

      <section className="card">
        <div className="flex items-center gap-3 mb-4">
          <Clock className="h-5 w-5 text-brand-400" />
          <h3 className="font-semibold text-white">Horarios de atención</h3>
        </div>
        <p className="text-sm text-slate-400 mb-4">
          Configura los días y horarios en que tu negocio atiende. Los clientes solo podrán reservar dentro de estos horarios.
        </p>
        {loadingSchedules ? (
          <LoadingSpinner label="Cargando horarios..." />
        ) : schedulesError ? (
          <ErrorAlert message={schedulesError} onRetry={fetchSchedules} />
        ) : (
          <div className="space-y-2">
            {DAYS.map((day, idx) => {
              const daySchedules = schedules.filter((s) => s.dayOfWeek === idx);
              return (
                <div key={idx} className="flex items-center gap-3 rounded-lg border border-slate-700/50 bg-slate-800/30 p-3">
                  <span className="text-sm font-medium text-white w-24">{day}</span>
                  {daySchedules.length === 0 ? (
                    <>
                      <span className="text-xs text-slate-500 flex-1">Cerrado</span>
                      <button type="button" onClick={() => handleAddSchedule(idx)}
                        className="text-brand-400 hover:text-brand-300 text-xs flex items-center gap-1">
                        <Plus className="h-3 w-3" /> Agregar
                      </button>
                    </>
                  ) : (
                    <div className="flex-1 space-y-1">
                      {daySchedules.map((sched) => (
                        <div key={sched.id} className="flex items-center gap-2">
                          <button type="button" onClick={() => handleToggleDay(sched)}
                            className={`w-8 h-4 rounded-full relative transition-colors ${sched.isActive ? 'bg-emerald-500' : 'bg-slate-600'}`}>
                            <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${sched.isActive ? 'right-0.5' : 'left-0.5'}`} />
                          </button>
                          <input type="time" value={timeDrafts[draftKey(sched, 'startTime')] ?? sched.startTime}
                            onChange={(e) => setTimeDrafts((prev) => ({ ...prev, [draftKey(sched, 'startTime')]: e.target.value }))}
                            onBlur={() => handleTimeBlur(sched, 'startTime')}
                            className="input text-xs py-1 px-2 w-24" disabled={!sched.isActive} />
                          <span className="text-slate-500 text-xs">a</span>
                          <input type="time" value={timeDrafts[draftKey(sched, 'endTime')] ?? sched.endTime}
                            onChange={(e) => setTimeDrafts((prev) => ({ ...prev, [draftKey(sched, 'endTime')]: e.target.value }))}
                            onBlur={() => handleTimeBlur(sched, 'endTime')}
                            className="input text-xs py-1 px-2 w-24" disabled={!sched.isActive} />
                          <button type="button" onClick={() => handleDeleteSchedule(sched.id)}
                            className="text-slate-500 hover:text-red-400 transition-colors">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="flex justify-end">
        <button className="btn-primary" type="submit" disabled={isSaving || !form}>
          <Save className="h-4 w-4" /> {isSaving ? 'Guardando...' : 'Guardar cambios'}
        </button>
      </div>
    </form>
  );
}
