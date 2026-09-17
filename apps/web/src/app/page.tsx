import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Calendar,
  ShoppingBag,
  CreditCard,
  MessageCircle,
  Bot,
  BarChart3,
  ArrowRight,
  UserPlus,
  Settings,
  CalendarCheck,
  Utensils,
  Scissors,
  Sparkles,
  Stethoscope,
  Dumbbell,
  Wrench,
} from 'lucide-react';
import PricingSection from '@/components/landing/PricingSection';

export const metadata: Metadata = {
  title: 'Local B — Tu negocio en piloto automático',
  description:
    'Reservas, pedidos, cobros y atención por WhatsApp — todo desde un solo panel. Sin código.',
};

const features = [
  {
    icon: Calendar,
    title: 'Reservas inteligentes',
    description: 'Agenda automática con recordatorios y confirmaciones sin esfuerzo.',
  },
  {
    icon: ShoppingBag,
    title: 'Catálogo y pedidos',
    description: 'Muestra tus productos o servicios y recibe pedidos al instante.',
  },
  {
    icon: CreditCard,
    title: 'Cobros por WhatsApp',
    description: 'Genera links de pago y cobra sin salir de la conversación.',
  },
  {
    icon: MessageCircle,
    title: 'Multi-canal',
    description: 'WhatsApp, Instagram y web conectados en una sola bandeja.',
  },
  {
    icon: Bot,
    title: 'IA integrada',
    description: 'Un asistente que responde, agenda y vende por ti las 24 horas.',
  },
  {
    icon: BarChart3,
    title: 'Reportes automáticos',
    description: 'Métricas claras de ventas, reservas y clientes en tiempo real.',
  },
];

const steps = [
  {
    icon: UserPlus,
    number: '01',
    title: 'Crea tu cuenta',
    description: 'Regístrate en minutos, sin tarjeta de crédito ni instalaciones.',
  },
  {
    icon: Settings,
    number: '02',
    title: 'Configura tu bot',
    description: 'Elige tu giro de negocio y personaliza horarios, precios y mensajes.',
  },
  {
    icon: CalendarCheck,
    number: '03',
    title: 'Recibe reservas',
    description: 'Tus clientes reservan y pagan solos, tú solo administras.',
  },
];

const templates = [
  { icon: Utensils, name: 'Restaurante' },
  { icon: Scissors, name: 'Barbería' },
  { icon: Sparkles, name: 'Spa' },
  { icon: Stethoscope, name: 'Dentista' },
  { icon: Dumbbell, name: 'Gimnasio' },
  { icon: Wrench, name: 'Taller mecánico' },
];

const stats = [
  { value: '500+', label: 'negocios' },
  { value: '10,000+', label: 'reservas' },
  { value: '15', label: 'giros de negocio' },
  { value: '24/7', label: 'atención' },
];


const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Local B',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  description:
    'Plataforma SaaS para negocios locales: reservas, pedidos, cobros y atención por WhatsApp desde un solo panel.',
  url: 'https://localb.app',
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
    description: 'Plan gratuito disponible',
  },
  featureList: [
    'Reservas inteligentes',
    'Catálogo y pedidos',
    'Cobros por WhatsApp',
    'IA integrada',
    'Reportes automáticos',
  ],
};

export default function Home() {
  return (
    <div className="min-h-screen bg-surface text-slate-50">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-slate-800/60 bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-sm font-bold text-white">
              B
            </span>
            <span className="text-lg font-semibold tracking-tight text-white">Local B</span>
          </Link>
          <nav className="hidden items-center gap-8 text-sm text-slate-300 md:flex">
            <a href="#features" className="transition-colors hover:text-white">
              Funciones
            </a>
            <a href="#how-it-works" className="transition-colors hover:text-white">
              Cómo funciona
            </a>
            <a href="#templates" className="transition-colors hover:text-white">
              Giros de negocio
            </a>
            <a href="#pricing" className="transition-colors hover:text-white">
              Precios
            </a>
            <a href="#demo" className="transition-colors hover:text-white">
              Demo
            </a>
          </nav>
          <div className="flex items-center gap-3">
            <Link href="/login" className="hidden text-sm font-medium text-slate-300 transition-colors hover:text-white sm:block">
              Iniciar sesión
            </Link>
            <Link href="/register" className="btn-primary">
              Empezar gratis
            </Link>
          </div>
        </div>
      </header>

      <main className="scroll-smooth">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10"
            style={{
              background:
                'radial-gradient(60% 50% at 50% 0%, rgba(56,189,248,0.16) 0%, rgba(56,189,248,0) 70%), radial-gradient(40% 40% at 85% 20%, rgba(14,165,233,0.12) 0%, rgba(14,165,233,0) 70%)',
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 opacity-[0.07]"
            style={{
              backgroundImage:
                'linear-gradient(to right, #38BDF8 1px, transparent 1px), linear-gradient(to bottom, #38BDF8 1px, transparent 1px)',
              backgroundSize: '48px 48px',
              maskImage: 'radial-gradient(ellipse 60% 50% at 50% 0%, black 40%, transparent 100%)',
            }}
          />

          <div className="mx-auto max-w-5xl px-6 pb-16 pt-20 text-center sm:pt-28 md:pb-20">
            <div className="mb-6 flex justify-center animate-fade-in-up">
              <span className="badge-new">
                <Sparkles className="mr-1.5 h-3 w-3" />
                Nuevo: asistente con IA para WhatsApp
              </span>
            </div>

            <h1 className="animate-fade-in-up text-4xl font-bold leading-[1.1] tracking-tight text-white [animation-delay:80ms] sm:text-6xl md:text-7xl">
              Tu negocio en{' '}
              <span className="bg-gradient-to-r from-brand-300 via-brand-400 to-brand-500 bg-clip-text text-transparent">
                piloto automático
              </span>
            </h1>

            <p className="mx-auto mt-6 max-w-2xl animate-fade-in-up text-lg text-slate-400 [animation-delay:160ms] sm:text-xl">
              Reservas, pedidos, cobros y atención por WhatsApp — todo desde un solo panel.
              Sin código.
            </p>

            <div className="mt-10 flex animate-fade-in-up flex-col items-center justify-center gap-3 [animation-delay:240ms] sm:flex-row">
              <Link href="/register" className="btn-primary w-full px-6 py-3 text-base sm:w-auto">
                Empezar gratis
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/dashboard" className="btn-secondary w-full px-6 py-3 text-base sm:w-auto">
                Ver demo
              </Link>
            </div>

            <p className="mt-6 animate-fade-in-up text-xs text-slate-500 [animation-delay:320ms]">
              No requiere tarjeta de crédito · Configuración en 5 minutos
            </p>
          </div>
        </section>

        {/* Stats */}
        <section className="border-y border-slate-800/60 bg-surface-50/50">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-6 py-12 sm:grid-cols-4">
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-3xl font-bold text-white sm:text-4xl">{stat.value}</div>
                <div className="mono-label mt-1">{stat.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section id="features" className="mx-auto max-w-7xl px-6 py-16 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <span className="mono-label">Funciones</span>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Todo lo que tu negocio necesita
            </h2>
            <p className="mt-4 text-lg text-slate-400">
              Una plataforma completa para vender, agendar y cobrar sin complicaciones.
            </p>
          </div>

          <div className="mt-16 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <div key={feature.title} className="card-accent group">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-500/10 text-brand-400 transition-colors group-hover:bg-brand-500/20">
                  <feature.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-base font-semibold text-white">{feature.title}</h3>
                <p className="mt-1.5 text-sm text-slate-400">{feature.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="border-y border-slate-800/60 bg-surface-50/50 py-16 sm:py-20">
          <div className="mx-auto max-w-7xl px-6">
            <div className="mx-auto max-w-2xl text-center">
              <span className="mono-label">Cómo funciona</span>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
                Empieza en tres pasos
              </h2>
            </div>

            <div className="relative mt-16 grid grid-cols-1 gap-8 md:grid-cols-3">
              <div
                aria-hidden
                className="absolute left-0 right-0 top-6 hidden h-px bg-gradient-to-r from-transparent via-slate-700 to-transparent md:block"
              />
              {steps.map((step) => (
                <div key={step.number} className="relative text-center">
                  <div className="relative mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-brand-500/30 bg-surface text-brand-400">
                    <step.icon className="h-5 w-5" />
                  </div>
                  <div className="mono-label mt-4">{step.number}</div>
                  <h3 className="mt-1 text-lg font-semibold text-white">{step.title}</h3>
                  <p className="mx-auto mt-2 max-w-xs text-sm text-slate-400">{step.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Templates */}
        <section id="templates" className="mx-auto max-w-7xl px-6 py-16 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <span className="mono-label">Plantillas listas para usar</span>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Para cualquier tipo de negocio
            </h2>
            <p className="mt-4 text-lg text-slate-400">
              Elige tu giro y empieza con una configuración pensada para tu industria.
            </p>
          </div>

          <div className="mt-16 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {templates.map((template) => (
              <div
                key={template.name}
                className="card flex flex-col items-center gap-3 py-8 text-center transition-transform hover:-translate-y-1"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-100 text-brand-400">
                  <template.icon className="h-5 w-5" />
                </div>
                <span className="text-sm font-medium text-slate-200">{template.name}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="border-y border-slate-800/60 bg-surface-50/50 py-16 sm:py-20">
          <div className="mx-auto max-w-7xl px-6">
            <div className="mx-auto max-w-2xl text-center">
              <span className="mono-label">Precios</span>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
                Un plan para cada etapa
              </h2>
              <p className="mt-4 text-lg text-slate-400">
                Empezá gratis y escalá cuando tu negocio lo necesite.
              </p>
            </div>

            <PricingSection />
          </div>
        </section>

        {/* Live Demo */}
        <section id="demo" className="py-16 sm:py-20">
          <div className="mx-auto max-w-7xl px-6">
            <div className="mx-auto max-w-2xl text-center">
              <span className="mono-label">Demo en vivo</span>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
                Probá el asistente ahora
              </h2>
              <p className="mt-4 text-lg text-slate-400">
                Chateá con nuestro bot demo y mirá cómo responde sobre servicios, reservas y más.
              </p>
            </div>
            <div className="mt-10 flex justify-center">
              <div className="w-full max-w-md rounded-2xl border border-slate-700/50 overflow-hidden shadow-2xl" style={{ height: '500px' }}>
                <iframe
                  src="/chat/demo"
                  className="h-full w-full border-0"
                  title="Chat demo"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="relative overflow-hidden border-y border-slate-800/60">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10"
            style={{
              background:
                'radial-gradient(50% 80% at 50% 50%, rgba(56,189,248,0.14) 0%, rgba(56,189,248,0) 70%)',
            }}
          />
          <div className="mx-auto max-w-3xl px-6 py-16 text-center sm:py-20">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Empieza gratis hoy
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-slate-400">
              Únete a cientos de negocios que ya venden y agendan en piloto automático.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/register" className="btn-primary px-6 py-3 text-base">
                Empieza gratis hoy
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/dashboard" className="btn-secondary px-6 py-3 text-base">
                Ver demo
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="mx-auto max-w-7xl px-6 py-12">
        <div className="flex flex-col items-center justify-between gap-6 border-t border-slate-800/60 pt-8 sm:flex-row">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-500 text-xs font-bold text-white">
              B
            </span>
            <span className="text-sm font-semibold text-white">Local B</span>
          </div>

          <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-slate-400">
            <Link href="/dashboard" className="transition-colors hover:text-white">
              Panel
            </Link>
            <Link href="/login" className="transition-colors hover:text-white">
              Iniciar sesión
            </Link>
            <Link href="/register" className="transition-colors hover:text-white">
              Registrarse
            </Link>
          </nav>

          <p className="text-xs text-slate-500">&copy; 2026 Local B. Todos los derechos reservados.</p>
        </div>
      </footer>
    </div>
  );
}
