'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';

interface PlanData {
  name: string;
  price: number;
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

const FALLBACK_PLANS: PlanData[] = [
  {
    name: 'Gratis',
    price: 0,
    description: 'Para probar sin compromiso',
    features: ['1 bot', '500 mensajes/mes', '100 contactos', 'Web Chat', 'Soporte por email'],
    cta: 'Empezar gratis',
    popular: false,
  },
  {
    name: 'Starter',
    price: 29,
    description: 'Para negocios que arrancan',
    features: ['3 bots', '5,000 mensajes/mes', '1,000 contactos', 'WhatsApp + Telegram', '5 superpoderes', 'Reportes básicos'],
    cta: 'Elegir Starter',
    popular: false,
  },
  {
    name: 'Pro',
    price: 79,
    description: 'Para negocios en crecimiento',
    features: ['10 bots', '25,000 mensajes/mes', '10,000 contactos', 'Todos los canales', 'Todos los superpoderes', 'API + Webhooks', 'White-label', 'Soporte prioritario'],
    cta: 'Elegir Pro',
    popular: true,
  },
  {
    name: 'Enterprise',
    price: 199,
    description: 'Para agencias y equipos grandes',
    features: ['Bots ilimitados', 'Mensajes ilimitados', 'Contactos ilimitados', 'Modo Agencia', 'Soporte dedicado', 'SLA 99.9%', 'Onboarding personalizado'],
    cta: 'Contactar ventas',
    popular: false,
  },
];

const TIER_META: Record<string, { description: string; cta: string; popular: boolean }> = {
  FREE: { description: 'Para probar sin compromiso', cta: 'Empezar gratis', popular: false },
  STARTER: { description: 'Para negocios que arrancan', cta: 'Elegir Starter', popular: false },
  PRO: { description: 'Para negocios en crecimiento', cta: 'Elegir Pro', popular: true },
  ENTERPRISE: { description: 'Para agencias y equipos grandes', cta: 'Contactar ventas', popular: false },
};

function formatNumber(n: number): string {
  return n.toLocaleString('es-AR');
}

function mapApiPlan(plan: ApiPlan): PlanData {
  const meta = TIER_META[plan.tier] || { description: '', cta: `Elegir ${plan.name}`, popular: false };
  const price = Number(plan.priceMonthly);

  // Build feature list from plan limits + extra features
  const features: string[] = [];

  if (plan.tier === 'ENTERPRISE') {
    features.push('Bots ilimitados', 'Mensajes ilimitados', 'Contactos ilimitados');
  } else {
    features.push(
      `${formatNumber(plan.maxBots)} bot${plan.maxBots > 1 ? 's' : ''}`,
      `${formatNumber(plan.maxMessages)} mensajes/mes`,
      `${formatNumber(plan.maxContacts)} contactos`,
    );
  }

  // Append any extra features from the DB
  features.push(...plan.features);

  return {
    name: plan.name,
    price,
    description: meta.description,
    features,
    cta: meta.cta,
    popular: meta.popular,
  };
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

export default function PricingSection() {
  const [plans, setPlans] = useState<PlanData[]>(FALLBACK_PLANS);

  useEffect(() => {
    let cancelled = false;

    async function fetchPlans() {
      try {
        const res = await fetch(`${API_URL}/plans/public`);
        if (!res.ok) return;
        const data: ApiPlan[] = await res.json();
        if (!cancelled && data.length > 0) {
          setPlans(data.map(mapApiPlan));
        }
      } catch {
        // Silently fall back to hardcoded plans
      }
    }

    fetchPlans();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="mt-16 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
      {plans.map((plan) => (
        <div
          key={plan.name}
          className={`relative rounded-2xl border p-6 flex flex-col transition-transform hover:-translate-y-1 ${
            plan.popular
              ? 'border-brand-400/50 bg-brand-400/5 shadow-lg shadow-brand-400/10'
              : 'border-slate-700/50 bg-surface'
          }`}
        >
          {plan.popular && (
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand-400 px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
              Popular
            </span>
          )}
          <h3 className="text-lg font-bold text-white">{plan.name}</h3>
          <p className="text-xs text-slate-500 mt-1">{plan.description}</p>
          <div className="mt-4 mb-6">
            <span className="text-4xl font-bold text-white">${plan.price}</span>
            <span className="text-sm text-slate-500">/mes</span>
          </div>
          <ul className="space-y-2.5 flex-1 mb-6">
            {plan.features.map((feature, i) => (
              <li key={`${feature}-${i}`} className="flex items-start gap-2 text-sm text-slate-300">
                <Check className="h-4 w-4 text-brand-400 shrink-0 mt-0.5" />
                {feature}
              </li>
            ))}
          </ul>
          <Link
            href="/register"
            className={`w-full text-center rounded-lg py-2.5 text-sm font-medium transition-colors ${
              plan.popular
                ? 'bg-brand-400 text-white hover:bg-brand-500'
                : 'border border-slate-700 text-slate-300 hover:bg-surface-100 hover:text-white'
            }`}
          >
            {plan.cta}
          </Link>
        </div>
      ))}
    </div>
  );
}
