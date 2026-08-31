'use client';

import { useState } from 'react';
import { Check, Clock, DollarSign, ArrowLeft, ArrowRight, CalendarDays } from 'lucide-react';
import { MOCK_SERVICES } from '@/constants/services';
import { TIME_SLOTS } from '@/constants/bookings';

interface BookingFlowProps {
  slug: string;
}

type Step = 'service' | 'datetime' | 'info' | 'confirm';

const STEPS: { id: Step; label: string }[] = [
  { id: 'service', label: 'Servicio' },
  { id: 'datetime', label: 'Fecha y hora' },
  { id: 'info', label: 'Tus datos' },
  { id: 'confirm', label: 'Confirmación' },
];

export function BookingFlow({ slug }: BookingFlowProps) {
  const [step, setStep] = useState<Step>('service');
  const [serviceId, setServiceId] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const activeServices = MOCK_SERVICES.filter((s) => s.isActive);
  const selectedService = activeServices.find((s) => s.id === serviceId);
  const today = new Date().toISOString().slice(0, 10);

  const stepIdx = STEPS.findIndex((s) => s.id === step);

  const canNext = (): boolean => {
    switch (step) {
      case 'service': return !!serviceId;
      case 'datetime': return !!date && !!time;
      case 'info': return !!name.trim() && !!phone.trim();
      default: return true;
    }
  };

  const handleNext = () => {
    if (step === 'confirm') {
      setSubmitted(true);
      return;
    }
    const next = STEPS[stepIdx + 1];
    if (next) setStep(next.id);
  };

  const handleBack = () => {
    const prev = STEPS[stepIdx - 1];
    if (prev) setStep(prev.id);
  };

  if (submitted) {
    return (
      <div className="text-center py-16">
        <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-emerald-500/20 mb-6">
          <Check className="h-8 w-8 text-emerald-400" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">Reserva confirmada</h2>
        <p className="text-sm text-slate-400 mb-6">Te enviamos los detalles por WhatsApp/email.</p>
        <div className="card-accent max-w-sm mx-auto text-left space-y-2">
          <p className="text-sm text-white font-medium">{selectedService?.name}</p>
          <p className="text-xs text-slate-400">{date} a las {time}</p>
          <p className="text-xs text-slate-400">{name} · {phone}</p>
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
          {activeServices.map((s) => (
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
          ))}
        </div>
      )}

      {step === 'datetime' && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white">Elige fecha y hora</h2>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Fecha</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" min={today} />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-2 block">Hora disponible</label>
            <div className="grid grid-cols-4 gap-2">
              {TIME_SLOTS.map((t) => (
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
        </div>
      )}

      {step === 'confirm' && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white">Confirma tu reserva</h2>
          <div className="card-accent space-y-3">
            <div className="flex justify-between">
              <span className="text-xs text-slate-400">Servicio</span>
              <span className="text-sm text-white font-medium">{selectedService?.name}</span>
            </div>
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
          <button onClick={handleBack} className="btn-secondary text-xs">
            <ArrowLeft className="h-3.5 w-3.5" /> Anterior
          </button>
        ) : <div />}
        <button onClick={handleNext} disabled={!canNext()} className="btn-primary text-xs">
          {step === 'confirm' ? 'Confirmar reserva' : 'Siguiente'}
          {step !== 'confirm' && <ArrowRight className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}
