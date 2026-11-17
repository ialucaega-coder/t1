'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Clock, PiggyBank } from 'lucide-react';
import { computeRoi } from './roi';

interface SliderProps {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
}

function Slider({ label, hint, value, min, max, step = 1, unit = '', onChange }: SliderProps) {
  const id = useId();
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-xl font-semibold">
          {label}
        </label>
        <output htmlFor={id} className="poster-display text-2xl text-[var(--p-red)]">
          {value.toLocaleString('es-AR')}
          {unit}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="poster-range mt-2 w-full"
        style={{ ['--fill' as string]: `${pct}%` }}
      />
      {hint && <p className="mt-1 text-base text-[var(--p-mute)]">{hint}</p>}
    </div>
  );
}

export default function RoiCalculator() {
  const [perDay, setPerDay] = useState(60);
  const [minutes, setMinutes] = useState(4);
  const [hourValue, setHourValue] = useState(8);
  const [autoPct, setAutoPct] = useState(60);
  const r = computeRoi({ perDay, minutes, hourValue, autoPct });

  return (
    <section id="calculadora" className="poster-halftone scroll-mt-16">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
      <h2 className="poster-display mb-2 text-3xl sm:text-4xl">
        <span className="poster-banner">Calculá cuánto ahorrás</span>
      </h2>
      <p className="mb-6 max-w-2xl text-xl text-[var(--p-mute)]">
        Una estimación con tus números. Movelos y mirá cuánto tiempo te devuelve tu ejército de robots.
      </p>

      <div className="grid gap-6 md:grid-cols-[1.1fr_1fr]">
        <div className="poster-frame grid gap-5 p-5">
          <Slider label="Consultas por día" value={perDay} min={5} max={500} step={5} onChange={setPerDay} />
          <Slider label="Minutos por consulta" value={minutes} min={1} max={20} unit=" min" onChange={setMinutes} />
          <Slider label="Valor de tu hora" value={hourValue} min={1} max={100} unit=" USD" onChange={setHourValue} />
          <Slider
            label="Las que resuelve el robot solo"
            hint="Es un supuesto tuyo: ajustalo a tu negocio."
            value={autoPct}
            min={10}
            max={90}
            step={5}
            unit="%"
            onChange={setAutoPct}
          />
        </div>

        <div className="poster-frame poster-frame--red flex flex-col justify-between gap-5 p-5" aria-live="polite">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Clock className="mb-1 h-6 w-6" aria-hidden />
              <div className="poster-display text-4xl sm:text-5xl" data-testid="roi-hours">
                {r.hoursSaved.toLocaleString('es-AR')} h
              </div>
              <div className="text-xl leading-tight">de trabajo devueltas por mes</div>
            </div>
            <div>
              <PiggyBank className="mb-1 h-6 w-6" aria-hidden />
              <div className="poster-display text-4xl sm:text-5xl" data-testid="roi-money">
                ${r.moneySaved.toLocaleString('es-AR')}
              </div>
              <div className="text-xl leading-tight">USD de tu tiempo por mes</div>
            </div>
          </div>
          <p className="text-xl leading-snug">
            Con {r.messagesPerMonth.toLocaleString('es-AR')} mensajes al mes te conviene el plan{' '}
            <strong data-testid="roi-plan">{r.plan.name}</strong>
            {r.plan.price > 0 ? ` ($${r.plan.price}/mes)` : ' ($0/mes)'}.{' '}
            {r.net > 0 ? (
              <>
                Quedan <strong>${r.net.toLocaleString('es-AR')}</strong> a tu favor.
              </>
            ) : (
              'Probalo gratis y medí el resultado real.'
            )}
          </p>
          <Link href="/register" className="poster-btn poster-btn--ghost w-full">
            Empezar con {r.plan.name} <ArrowRight className="h-5 w-5" />
          </Link>
        </div>
      </div>
      </div>
    </section>
  );
}
