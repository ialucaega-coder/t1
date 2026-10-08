'use client';

import { FormEvent, useEffect, useState, useCallback } from 'react';
import { Save, Palette, Globe, Clock, Plus, Trash2, UserCog, Lock, CheckCircle, ShieldCheck } from 'lucide-react';
import { useSettings } from '@/hooks/use-settings';
import { useAuth } from '@/lib/auth-context';
import { THEME_OPTIONS } from '@/constants/settings';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import * as schedulesApi from '@/lib/api/schedules';
import * as authApi from '@/lib/api/auth';
import { useToast } from '@/components/common/Toast';
import { MotorDeIA } from '@/app/(dashboard)/ia/MotorDeIA';
import type { Schedule } from '@/types';

const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export default function ConfiguracionPage() {
  const { settings, isLoading, error, refetch, updateSettings } = useSettings();
  const { user, updateProfile } = useAuth();
  const [form, setForm] = useState(settings);
  const [isSaving, setIsSaving] = useState(false);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loadingSchedules, setLoadingSchedules] = useState(true);
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
  const { toast } = useToast();

  useEffect(() => {
    setForm(settings);
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
    try {
      const data = await schedulesApi.getSchedules();
      setSchedules(data);
    } catch { /* ignore */ }
    setLoadingSchedules(false);
  }, []);

  useEffect(() => { fetchSchedules(); }, [fetchSchedules]);

  // Lee el estado del 2FA al montar.
  useEffect(() => {
    let active = true;
    authApi.getTwoFactorStatus()
      .then((res) => { if (active) setTwoFactorEnabled(res.enabled); })
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
      await authApi.verifyTwoFactor(twoFactorCode);
      setTwoFactorEnabled(true);
      setTwoFactorSetup(null);
      setTwoFactorCode('');
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

  // Desactiva el 2FA pidiendo un código válido.
  async function handleDisableTwoFactor() {
    if (twoFactorCode.length !== 6) return;
    setTwoFactorBusy(true);
    try {
      await authApi.disableTwoFactor(twoFactorCode);
      setTwoFactorEnabled(false);
      setDisabling(false);
      setTwoFactorCode('');
      toast({ type: 'success', message: 'Autenticación en dos pasos desactivada' });
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
    } catch { /* ignore */ }
  }

  async function handleUpdateTime(schedule: Schedule, field: 'startTime' | 'endTime', value: string) {
    try {
      const updated = await schedulesApi.updateSchedule(schedule.id, { [field]: value });
      setSchedules((prev) => prev.map((s) => (s.id === schedule.id ? updated : s)));
    } catch { /* ignore */ }
  }

  async function handleDeleteSchedule(id: string) {
    try {
      await schedulesApi.deleteSchedule(id);
      setSchedules((prev) => prev.filter((s) => s.id !== id));
    } catch { /* ignore */ }
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
    } catch { /* ignore */ }
  }

  const updateField = (field: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    try {
      await updateSettings(form);
      toast({ type: 'success', message: 'Configuración guardada correctamente' });
    } catch {
      toast({ type: 'error', message: 'Error al guardar configuración' });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <LoadingSpinner label="Cargando configuración..." />;
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-3xl space-y-8">
      {error && <ErrorAlert message={error} onRetry={refetch} />}

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
            {!disabling ? (
              <button type="button" onClick={() => { setDisabling(true); setTwoFactorCode(''); }}
                className="btn-secondary text-xs">
                <Lock className="h-3.5 w-3.5" /> Desactivar 2FA
              </button>
            ) : (
              <div className="space-y-3 rounded-lg border border-slate-700/50 bg-slate-800/30 p-4">
                <p className="text-xs text-slate-400">
                  Ingresá un código de 6 dígitos de tu app para confirmar la desactivación.
                </p>
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
                <div className="flex gap-2">
                  <button type="button" onClick={() => { setDisabling(false); setTwoFactorCode(''); }}
                    className="btn-secondary text-xs">
                    Cancelar
                  </button>
                  <button type="button" onClick={handleDisableTwoFactor}
                    disabled={twoFactorBusy || twoFactorCode.length !== 6}
                    className="btn-primary text-xs disabled:opacity-40">
                    {twoFactorBusy ? 'Desactivando...' : 'Confirmar desactivación'}
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
                          <input type="time" value={sched.startTime}
                            onChange={(e) => handleUpdateTime(sched, 'startTime', e.target.value)}
                            className="input text-xs py-1 px-2 w-24" disabled={!sched.isActive} />
                          <span className="text-slate-500 text-xs">a</span>
                          <input type="time" value={sched.endTime}
                            onChange={(e) => handleUpdateTime(sched, 'endTime', e.target.value)}
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
        <button className="btn-primary" type="submit" disabled={isSaving}>
          <Save className="h-4 w-4" /> {isSaving ? 'Guardando...' : 'Guardar cambios'}
        </button>
      </div>
    </form>
  );
}
