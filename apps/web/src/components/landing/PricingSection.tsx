'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';

interface PlanData {
  name: string;
  monthly: number;
  yearly: number;
  description: string;
  features: string[];
  cta: string;
  popular: boolean;
}

interface ApiPlan {
  id: string;
  name: string;
  tier: string;
  priceMonthly: string | number;
  priceYearly: string | number;
  currency: string;
  maxBots: number;
  maxMessages: number;
  maxContacts: number;
  features: string[];
}

// Planes por defecto (iguales al diseño); se reemplazan por los de la API si responde.
const FALLBACK_PLANS: PlanData[] = [
  { name: 'Gratis', monthly: 0, yearly: 0, description: 'Para probar sin compromiso', features: ['1 bot', '500 mensajes/mes', '100 contactos', 'Catálogo básico'], cta: 'Empezar gratis', popular: false },
  { name: 'Starter', monthly: 29, yearly: 290, description: 'Para negocios que arrancan', features: ['3 bots', '5.000 mensajes/mes', '1.000 contactos', 'Reportes básicos'], cta: 'Elegir Starter', popular: false },
  { name: 'Pro', monthly: 79, yearly: 790, description: 'Para negocios en crecimiento', features: ['10 bots', '25.000 mensajes/mes', '10.000 contactos', 'IA avanzada', 'API access'], cta: 'Elegir Pro', popular: true },
  { name: 'Enterprise', monthly: 199, yearly: 1990, description: 'Para agencias y equipos grandes', features: ['Bots ilimitados', 'Mensajes ilimitados', 'Contactos ilimitados', 'SLA 99,9%', 'Onboarding dedicado'], cta: 'Contactar ventas', popular: false },
];

const TIER_META: Record<string, { description: string; cta: string; popular: boolean }> = {
  FREE: { description: 'Para probar sin compromiso', cta: 'Empezar gratis', popular: false },
  STARTER: { description: 'Para negocios que arrancan', cta: 'Elegir Starter', popular: false },
  PRO: { description: 'Para negocios en crecimiento', cta: 'Elegir Pro', popular: true },
  ENTERPRISE: { description: 'Para agencias y equipos grandes', cta: 'Contactar ventas', popular: false },
};

const fmt = (n: number) => n.toLocaleString('es-AR');

function mapApiPlan(plan: ApiPlan): PlanData {
  const meta = TIER_META[plan.tier] || { description: '', cta: `Elegir ${plan.name}`, popular: false };
  const features: string[] =
    plan.tier === 'ENTERPRISE'
      ? ['Bots ilimitados', 'Mensajes ilimitados', 'Contactos ilimitados']
      : [`${fmt(plan.maxBots)} bot${plan.maxBots > 1 ? 's' : ''}`, `${fmt(plan.maxMessages)} mensajes/mes`, `${fmt(plan.maxContacts)} contactos`];
  features.push(...plan.features);
  const monthly = Number(plan.priceMonthly);
  const yearly = Number(plan.priceYearly);
  return { name: plan.name, monthly, yearly: yearly > 0 ? yearly : monthly * 10, ...meta, features };
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

export default function PricingSection() {
  const [plans, setPlans] = useState<PlanData[]>(FALLBACK_PLANS);
  const [yearly, setYearly] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/plans/public`);
        if (!res.ok) return;
        const data: ApiPlan[] = await res.json();
        if (!cancelled && data.length > 0) setPlans(data.map(mapApiPlan));
      } catch {
        // Sin API: quedan los planes por defecto.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <div className="mb-6 flex items-center justify-center gap-3 text-xl font-semibold">
        <span className={yearly ? 'text-[var(--p-mute)]' : ''}>Mensual</span>
        <button
          type="button"
          role="switch"
          aria-checked={yearly}
          aria-label="Cobro anual (2 meses gratis)"
          onClick={() => setYearly((v) => !v)}
          className="poster-toggle relative h-8 w-14 border-2 border-[var(--p-paper)] bg-[var(--p-coal)] transition-colors"
        >
          <span className="poster-toggle-dot absolute left-1 top-1 h-5 w-5 bg-[var(--p-paper)] transition-transform" />
        </button>
        <span className={yearly ? '' : 'text-[var(--p-mute)]'}>
          Anual <span className="bg-[var(--p-red)] px-1.5 text-sm text-[var(--p-on-red)]">2 meses gratis</span>
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan) => {
          const price = yearly ? Math.round(plan.yearly / 12) : plan.monthly;
          return (
            <div key={plan.name} className={`poster-frame ${plan.popular ? 'poster-frame--red' : ''} relative flex flex-col p-5`}>
              {plan.popular && (
                <span className="poster-display poster-chip-dark absolute right-4 top-3 px-2 py-0.5 text-sm tracking-wider">★ Popular</span>
              )}
              <h3 className="poster-display text-3xl">{plan.name}</h3>
              <p className="mt-1 text-lg text-[var(--p-paper)]/70">{plan.description}</p>
              <div className="mb-1 mt-3">
                <span className="poster-display text-5xl">${price}</span>
                <span className="text-lg font-semibold"> /mes</span>
              </div>
              <p className="mb-4 h-5 text-sm text-[var(--p-paper)]/70">
                {yearly && plan.yearly > 0 ? `Facturado $${fmt(plan.yearly)} al año` : ' '}
              </p>
              <ul className="mb-5 flex-1 space-y-1.5">
                {plan.features.map((f, i) => (
                  <li key={`${f}-${i}`} className="flex items-start gap-2 text-xl leading-tight">
                    <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    {f}
                  </li>
                ))}
              </ul>
              <Link href="/register" className="poster-btn poster-btn--ghost w-full !text-base">
                {plan.cta}
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
