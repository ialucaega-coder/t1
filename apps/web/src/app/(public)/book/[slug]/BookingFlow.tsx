'use client';

import { useState, useEffect, useCallback } from 'react';
import { Check, Clock, DollarSign, ArrowLeft, ArrowRight, Loader2, User } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

interface Service {
  id: string;
  name: string;
  description: string | null;
  price: number;
  duration: number;
  category: string;
}

interface Schedule {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

interface Professional {
  id: string;
  name: string;
  specialties: string[];
}

interface BusinessInfo {
  id: string;
  name: string;
  slug: string;
  phone: string | null;
  address: string | null;
}

interface BookingFlowProps {
  slug: string;
}

type Step = 'service' | 'professional' | 'datetime' | 'info' | 'confirm';

const STEPS_WITH_PROF: { id: Step; label: string }[] = [
  { id: 'service', label: 'Servicio' },
  { id: 'professional', label: 'Profesional' },
  { id: 'datetime', label: 'Fecha y hora' },
  { id: 'info', label: 'Tus datos' },
  { id: 'confirm', label: 'Confirmación' },
];

const STEPS_NO_PROF: { id: Step; label: string }[] = [
  { id: 'service', label: 'Servicio' },
  { id: 'datetime', label: 'Fecha y hora' },
  { id: 'info', label: 'Tus datos' },
  { id: 'confirm', label: 'Confirmación' },
];

const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

export function BookingFlow({ slug }: BookingFlowProps) {
  const [step, setStep] = useState<Step>('service');
  const [serviceId, setServiceId] = useState('');
  const [professionalId, setProfessionalId] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // Verificación de teléfono por OTP (activada por el negocio/plataforma).
  const [requiresPhoneVerification, setRequiresPhoneVerification] = useState(false);
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpSending, setOtpSending] = useState(false);
  const [otpError, setOtpError] = useState('');

  const [business, setBusiness] = useState<BusinessInfo | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [loadingBiz, setLoadingBiz] = useState(true);
  const [bizError, setBizError] = useState('');

  const [slots, setSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${API_URL}/public/book/${slug}`);
        if (!res.ok) throw new Error('Negocio no encontrado');
        const data = await res.json();
        setBusiness(data.business);
        setServices(data.services);
        setSchedules(data.schedules);
        setProfessionals(data.professionals || []);
        setRequiresPhoneVerification(Boolean(data.requiresPhoneVerification));
      } catch {
        setBizError('No se pudo cargar la información del negocio');
      } finally {
        setLoadingBiz(false);
      }
    }
    load();
  }, [slug]);

  const fetchSlots = useCallback(async (d: string, sId: string, profId?: string) => {
    setLoadingSlots(true);
    setSlots([]);
    setTime('');
    try {
      let url = `${API_URL}/public/book/${slug}/slots?date=${d}&serviceId=${sId}`;
      if (profId) url += `&professionalId=${profId}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setSlots(data.slots);
      }
    } catch { /* ignore */ }
    finally { setLoadingSlots(false); }
  }, [slug]);

  const selectedService = services.find((s) => s.id === serviceId);
  const selectedProfessional = professionals.find((p) => p.id === professionalId);
  const today = new Date().toISOString().slice(0, 10);
  const STEPS = professionals.length > 1 ? STEPS_WITH_PROF : STEPS_NO_PROF;
  const stepIdx = STEPS.findIndex((s) => s.id === step);

  const activeDays = schedules.map((s) => s.dayOfWeek);

  function isDateAvailable(dateStr: string): boolean {
    const d = new Date(dateStr + 'T12:00:00');
    return activeDays.includes(d.getDay());
  }

  const canNext = (): boolean => {
    switch (step) {
      case 'service': return !!serviceId;
      case 'professional': return !!professionalId;
      case 'datetime': return !!date && !!time;
      case 'info':
        if (!name.trim() || !phone.trim()) return false;
        // Con verificación activa, exigimos el código de 6 dígitos.
        if (requiresPhoneVerification) return otpSent && otp.trim().length === 6;
        return true;
      default: return true;
    }
  };

  const requestOtp = async () => {
    if (!phone.trim()) return;
    setOtpSending(true);
    setOtpError('');
    try {
      const res = await fetch(`${API_URL}/public/book/${slug}/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'No se pudo enviar el código');
      }
      setOtpSent(true);
    } catch (err) {
      setOtpError(err instanceof Error ? err.message : 'No se pudo enviar el código');
    } finally {
      setOtpSending(false);
    }
  };

  const handleNext = async () => {
    if (step === 'confirm') {
      setSubmitting(true);
      setSubmitError('');
      try {
        const res = await fetch(`${API_URL}/public/book/${slug}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serviceId, professionalId: professionalId || undefined, date, time, name, phone, email, otp: otp || undefined }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Error al crear reserva');
        }
        setSubmitted(true);
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : 'Error al crear reserva');
      } finally {
        setSubmitting(false);
      }
      return;
    }
    const next = STEPS[stepIdx + 1];
    if (next) setStep(next.id);
  };

  const handleBack = () => {
    const prev = STEPS[stepIdx - 1];
    if (prev) setStep(prev.id);
  };

  function handleDateChange(d: string) {
    setDate(d);
    if (d && serviceId) {
      if (isDateAvailable(d)) {
        fetchSlots(d, serviceId, professionalId || undefined);
      } else {
        setSlots([]);
        setTime('');
      }
    }
  }

  if (loadingBiz) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        <span>Cargando...</span>
      </div>
    );
  }

  if (bizError || !business) {
    return (
      <div className="text-center py-16">
        <p className="text-sm text-red-400">{bizError || 'Negocio no encontrado'}</p>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="text-center py-16">
        <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-emerald-500/20 mb-6">
          <Check className="h-8 w-8 text-emerald-400" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">Reserva confirmada</h2>
        <p className="text-sm text-slate-400 mb-6">Te contactaremos para confirmar tu cita.</p>
        <div className="card-accent max-w-sm mx-auto text-left space-y-2">
          <p className="text-sm text-white font-medium">{selectedService?.name}</p>
          <p className="text-xs text-slate-400">{date} a las {time}</p>
          <p className="text-xs text-slate-400">{name} · {phone}</p>
          {selectedService && (
            <p className="text-sm font-bold text-brand-400">${selectedService.price.toLocaleString()}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex items-center gap-2">
            <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold ${
              i < stepIdx ? 'bg-emerald-500 text-white' :
              i === stepIdx ? 'bg-brand-500 text-white' :
              'bg-surface-200 text-slate-500'
            }`}>
              {i < stepIdx ? <Check className="h-4 w-4" /> : i + 1}
            </div>
            {i < STEPS.length - 1 && <div className={`h-px w-8 ${i < stepIdx ? 'bg-emerald-500' : 'bg-slate-700'}`} />}
          </div>
        ))}
      </div>

      {step === 'service' && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-white">Elige un servicio</h2>
          {services.length === 0 ? (
            <p className="text-sm text-slate-400">No hay servicios disponibles en este momento.</p>
          ) : (
            services.map((s) => (
              <button
                key={s.id}
                onClick={() => setServiceId(s.id)}
                className={`w-full text-left card-accent flex items-center justify-between transition-all ${
                  serviceId === s.id ? 'ring-2 ring-brand-500' : ''
                }`}
              >
                <div>
                  <p className="text-sm font-medium text-white">{s.name}</p>
                  <p className="text-xs text-slate-400">{s.category}</p>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-1 text-xs text-slate-400">
                    <Clock className="h-3 w-3" /> {s.duration} min
                  </div>
                  <div className="flex items-center gap-1 text-sm font-medium text-brand-400">
                    <DollarSign className="h-3 w-3" /> {s.price.toLocaleString()}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      )}

      {step === 'professional' && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-white">Elige un profesional</h2>
          {professionals.map((p) => (
            <button
              key={p.id}
              onClick={() => setProfessionalId(p.id)}
              className={`w-full text-left card-accent flex items-center gap-3 transition-all ${
                professionalId === p.id ? 'ring-2 ring-brand-500' : ''
              }`}
            >
              <div className="h-10 w-10 rounded-full bg-brand-500/20 flex items-center justify-center shrink-0">
                <User className="h-5 w-5 text-brand-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-white">{p.name}</p>
                {p.specialties.length > 0 && (
                  <p className="text-xs text-slate-400">{p.specialties.join(' · ')}</p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {step === 'datetime' && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white">Elige fecha y hora</h2>

          {schedules.length > 0 && (
            <div className="text-xs text-slate-500">
              Atendemos: {schedules.map((s) => `${DAY_NAMES[s.dayOfWeek]} ${s.startTime}–${s.endTime}`).join(' · ')}
            </div>
          )}

          <div>
            <label className="text-xs text-slate-500 mb-1 block">Fecha</label>
            <input
              type="date"
              value={date}
              onChange={(e) => handleDateChange(e.target.value)}
              className="input"
              min={today}
            />
            {date && !isDateAvailable(date) && (
              <p className="text-xs text-amber-400 mt-1">El negocio no atiende este día. Elegí otro día.</p>
            )}
          </div>

          <div>
            <label className="text-xs text-slate-500 mb-2 block">Hora disponible</label>
            {loadingSlots ? (
              <div className="flex items-center gap-2 text-slate-400 text-sm py-4">
                <Loader2 className="h-4 w-4 animate-spin" /> Consultando disponibilidad...
              </div>
            ) : !date ? (
              <p className="text-xs text-slate-500">Seleccioná una fecha primero</p>
            ) : slots.length === 0 ? (
              <p className="text-xs text-slate-400">No hay horarios disponibles para esta fecha.</p>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {slots.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTime(t)}
                    className={`py-2 rounded-lg text-xs font-medium transition-colors ${
                      time === t ? 'bg-brand-500 text-white' : 'bg-surface-200 text-slate-400 hover:text-white'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {step === 'info' && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white">Tus datos</h2>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Nombre *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="Tu nombre completo" required />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Teléfono *</label>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="input" placeholder="+54 11 1234-5678" required />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Email (opcional)</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input" placeholder="tu@email.com" />
          </div>

          {requiresPhoneVerification && (
            <div className="card-accent space-y-3">
              <p className="text-xs text-slate-400">
                Para confirmar que el teléfono es tuyo, te enviamos un código por WhatsApp.
              </p>
              {!otpSent ? (
                <button
                  type="button"
                  onClick={requestOtp}
                  disabled={!phone.trim() || otpSending}
                  className="btn-secondary text-xs w-full justify-center"
                >
                  {otpSending ? (<><Loader2 className="h-3.5 w-3.5 animate-spin" /> Enviando...</>) : 'Enviar código por WhatsApp'}
                </button>
              ) : (
                <>
                  <label className="text-xs text-slate-500 block">Código de verificación</label>
                  <input
                    inputMode="numeric"
                    maxLength={6}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="input tracking-[0.4em] text-center text-lg font-mono"
                    placeholder="______"
                  />
                  <button
                    type="button"
                    onClick={requestOtp}
                    disabled={otpSending}
                    className="text-xs text-brand-400 hover:underline disabled:opacity-50"
                  >
                    {otpSending ? 'Reenviando...' : 'Reenviar código'}
                  </button>
                </>
              )}
              {otpError && <p className="text-xs text-red-400">{otpError}</p>}
            </div>
          )}
        </div>
      )}

      {step === 'confirm' && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white">Confirma tu reserva</h2>
          {submitError && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-xs text-red-400">
              {submitError}
            </div>
          )}
          <div className="card-accent space-y-3">
            <div className="flex justify-between">
              <span className="text-xs text-slate-400">Servicio</span>
              <span className="text-sm text-white font-medium">{selectedService?.name}</span>
            </div>
            {selectedProfessional && (
              <div className="flex justify-between">
                <span className="text-xs text-slate-400">Profesional</span>
                <span className="text-sm text-white">{selectedProfessional.name}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-xs text-slate-400">Duración</span>
              <span className="text-sm text-white">{selectedService?.duration} min</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-slate-400">Fecha</span>
              <span className="text-sm text-white">{date}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-slate-400">Hora</span>
              <span className="text-sm text-white">{time}</span>
            </div>
            <div className="border-t border-slate-700/50 pt-3 flex justify-between">
              <span className="text-xs text-slate-400">Total</span>
              <span className="text-lg font-bold text-brand-400">${selectedService?.price.toLocaleString()}</span>
            </div>
          </div>
          <div className="card-accent">
            <p className="text-xs text-slate-400 mb-1">Cliente</p>
            <p className="text-sm text-white">{name}</p>
            <p className="text-xs text-slate-400">{phone} {email && `· ${email}`}</p>
          </div>
        </div>
      )}

      <div className="flex justify-between pt-4">
        {stepIdx > 0 ? (
          <button onClick={handleBack} className="btn-secondary text-xs" disabled={submitting}>
            <ArrowLeft className="h-3.5 w-3.5" /> Anterior
          </button>
        ) : <div />}
        <button onClick={handleNext} disabled={!canNext() || submitting} className="btn-primary text-xs">
          {submitting ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Reservando...</>
          ) : step === 'confirm' ? (
            'Confirmar reserva'
          ) : (
            <>Siguiente <ArrowRight className="h-3.5 w-3.5" /></>
          )}
        </button>
      </div>
    </div>
  );
}
