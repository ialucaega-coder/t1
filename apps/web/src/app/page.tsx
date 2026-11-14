import type { Metadata } from 'next';
import Link from 'next/link';
import { Anton, Barlow_Condensed } from 'next/font/google';
import { ArrowRight, Play, Store, CalendarCheck, Layers, Headphones, UserRound, Settings, ChevronsRight } from 'lucide-react';
import LandingNav from '@/components/landing/LandingNav';
import RubrosExplorer from '@/components/landing/RubrosExplorer';
import PricingSection from '@/components/landing/PricingSection';
import Reveal from '@/components/landing/Reveal';
import CountUp from '@/components/landing/CountUp';
import Marquee from '@/components/landing/Marquee';
import RoiCalculator from '@/components/landing/RoiCalculator';
import Faq from '@/components/landing/Faq';
import StickyCta from '@/components/landing/StickyCta';
import { cookies } from 'next/headers';
import { THEME_COOKIE, parseTheme } from '@/components/landing/theme';
import { HeroArt } from '@/components/landing/HeroMotion';
import '@/components/landing/poster.css';

const display = Anton({ weight: '400', subsets: ['latin'], variable: '--font-poster-display', display: 'swap' });
const body = Barlow_Condensed({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-poster-body',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Mr. Go Assistance — Tu ejército de robots en tu negocio',
  description:
    'Asistentes inteligentes que automatizan reservas, pedidos, cobros, atención al cliente y más, 24/7. Sin código.',
  openGraph: {
    title: 'Mr. Go Assistance — Tu ejército de robots en tu negocio',
    description: 'Asistentes inteligentes que automatizan reservas, pedidos, cobros y atención al cliente, 24/7.',
    images: [{ url: '/landing/hero-art.webp', width: 1024, height: 268, alt: 'Mr. Go y su gato mascota' }],
  },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Mr. Go Assistance',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  description:
    'Plataforma SaaS para negocios locales: reservas, pedidos, cobros y atención por WhatsApp desde un solo panel.',
  url: 'https://localb.app',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', description: 'Plan gratuito disponible' },
  featureList: ['Reservas inteligentes', 'Catálogo y pedidos', 'Cobros por WhatsApp', 'IA integrada', 'Reportes automáticos'],
};

const steps = [
  { icon: UserRound, n: '01', title: 'Creá tu cuenta', text: 'Registrate en minutos, sin tarjeta ni instalación.' },
  { icon: Settings, n: '02', title: 'Configurá tu equipo', text: 'Elegí tus robots, horarios y servicios.' },
  { icon: Play, n: '03', title: 'Ponélos a trabajar', text: 'Tu ejército de robots opera por vos, 24/7.' },
];

export default async function Home() {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <div data-poster-theme={theme} className={`poster min-h-screen ${display.variable} ${body.variable}`}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <a
        href="#contenido"
        className="sr-only z-[60] bg-[var(--p-paper)] px-4 py-2 text-lg font-bold text-[var(--p-ink)] focus:not-sr-only focus:fixed focus:left-2 focus:top-2"
      >
        Saltar al contenido
      </a>
      <LandingNav />

      <main id="contenido" tabIndex={-1} className="outline-none">
        {/* Hero */}
        <section id="inicio" className="poster-dark poster-rays-hero scroll-mt-16 border-b-2 border-[var(--p-red)]">
          <HeroArt />
          <div className="mx-auto max-w-3xl px-4 pb-10 text-center sm:px-6">
            <h1 className="poster-display poster-slam text-5xl sm:text-6xl lg:text-7xl">
              <span className="poster-plate">
                <span>
                  Tu ejército
                  <br />
                  de robots
                </span>
              </span>
              <span className="poster-banner poster-banner--flip mt-2 text-4xl sm:text-5xl lg:text-6xl">En tu negocio</span>
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-xl font-medium leading-snug sm:text-2xl">
              Asistentes inteligentes que automatizan reservas, pedidos, cobros, atención al cliente y más, 24/7.
            </p>
            <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/register" className="poster-btn poster-btn--red w-full sm:w-auto">
                Empezar gratis <ArrowRight className="h-5 w-5" />
              </Link>
              <a href="#demo" className="poster-btn poster-btn--ghost w-full sm:w-auto">
                <Play className="h-5 w-5" /> Ver demo
              </a>
            </div>
          </div>
        </section>

        <Marquee />

        {/* Cifras */}
        <section aria-label="Cifras" className="poster-dark border-b-2 border-[var(--p-line)]">
          <dl className="mx-auto grid max-w-6xl grid-cols-2 gap-y-6 px-4 py-6 sm:px-6 md:grid-cols-4">
            {[
              { icon: Store, node: <CountUp to={500} suffix="+" />, label: 'Negocios' },
              { icon: CalendarCheck, node: <CountUp to={10000} suffix="+" />, label: 'Reservas' },
              { icon: Layers, node: <CountUp to={15} />, label: 'Giros de negocio' },
              { icon: Headphones, node: <>24/7</>, label: 'Operación' },
            ].map((s, i) => (
              <div key={s.label} className={`flex items-center justify-center gap-3 ${i > 0 ? 'md:border-l-2 md:border-[var(--p-line)]' : ''}`}>
                <s.icon className="h-9 w-9 shrink-0" aria-hidden />
                <div>
                  <dd className="poster-display text-3xl">{s.node}</dd>
                  <dt className="-mt-0.5 text-base font-semibold text-[var(--p-mute)]">{s.label}</dt>
                </div>
              </div>
            ))}
          </dl>
        </section>

        <RubrosExplorer>
          {/* Cómo funciona */}
          <section id="como-funciona" className="poster-band poster-rays-soft scroll-mt-16 border-y-2 border-[var(--p-line)] py-12">
            <div className="mx-auto max-w-7xl px-4 sm:px-6">
              <h2 className="poster-display mb-8 flex flex-wrap items-center justify-center gap-3 text-3xl sm:text-4xl">
                <span className="poster-banner">Cómo funciona</span>
                <span>En tres pasos</span>
              </h2>
              <ol className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
                {steps.flatMap((s, i) => [
                  <li key={s.n} className="min-w-0">
                    <Reveal delay={i * 100} className="h-full">
                      <Link href="/register" className="poster-card poster-frame flex h-full items-center gap-4 p-4">
                        <span className="poster-display shrink-0 -skew-x-6 text-5xl text-[var(--p-red)]">{s.n}</span>
                        <s.icon className="h-9 w-9 shrink-0" aria-hidden />
                        <span>
                          <span className="block text-2xl font-bold leading-tight">{s.title}</span>
                          <span className="block text-xl leading-tight text-[var(--p-mute)]">{s.text}</span>
                        </span>
                      </Link>
                    </Reveal>
                  </li>,
                  i < steps.length - 1 ? (
                    <li key={`sep-${i}`} aria-hidden className="hidden items-center text-[var(--p-red)] lg:flex">
                      <ChevronsRight className="h-8 w-8" />
                    </li>
                  ) : null,
                ])}
              </ol>
            </div>
          </section>
        </RubrosExplorer>

        <RoiCalculator />

        {/* Planes */}
        <div aria-hidden className="poster-hazard" />
        <section id="precios" className="poster-stores scroll-mt-16 py-12">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <h2 className="poster-display mb-6 text-4xl sm:text-5xl">
              <span className="poster-banner">Planes</span>
            </h2>
            <PricingSection />
          </div>
        </section>

        <Faq />

        {/* Demo */}
        <section id="demo" className="poster-dark poster-demo-bg scroll-mt-16 py-16">
          <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-8 px-4 sm:px-6 md:grid-cols-2">
            <div>
              <h2 className="poster-display text-4xl sm:text-5xl">
                <span className="poster-banner">Demo en vivo</span>
                <span className="mt-3 block">Probá tu ejército de robots</span>
              </h2>
              <p className="mt-4 max-w-lg text-2xl leading-snug text-[var(--p-paper)]/90">
                Chateá con nuestro bot demo y mirá cómo atiende, agenda, vende y cobra por vos.
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/landing/robot-demo.webp" alt="Robot de Mr. Go trabajando en su laptop" width={260} height={201} loading="lazy" className="poster-frame mt-6 hidden w-72 !border-[var(--p-red)] md:block" />
            </div>
            <div className="poster-frame mx-auto h-[500px] w-full max-w-md overflow-hidden">
              <iframe src="/chat/demo" title="Chat demo de Mr. Go" className="h-full w-full border-0" loading="lazy" />
            </div>
          </div>
        </section>
      </main>

      <StickyCta />

      <div aria-hidden className="poster-hazard" />
      <footer className="poster-dark">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 py-6 sm:flex-row sm:px-6">
          <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-base font-semibold uppercase tracking-wide text-[var(--p-mute)]" aria-label="Pie">
            <Link href="/dashboard" className="hover:text-white">Panel</Link>
            <Link href="/login" className="hover:text-white">Iniciar sesión</Link>
            <Link href="/register" className="hover:text-white">Registrarse</Link>
          </nav>
          <p className="text-sm text-[var(--p-mute)]">&copy; 2026 Mr. Go Assistance. Todos los derechos reservados.</p>
        </div>
      </footer>
    </div>
  );
}
