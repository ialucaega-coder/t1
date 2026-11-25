'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Home, LayoutGrid, Cog, Tag, Play, Menu, X, Briefcase } from 'lucide-react';
import ThemeToggle from './ThemeToggle';

const LINKS = [
  { id: 'inicio', label: 'Inicio', icon: Home },
  { id: 'equipo', label: 'Funciones', icon: LayoutGrid },
  { id: 'como-funciona', label: 'Cómo funciona', icon: Cog },
  { id: 'giros', label: 'Giros de negocio', icon: Briefcase },
  { id: 'precios', label: 'Precios', icon: Tag },
  { id: 'demo', label: 'Demo', icon: Play },
];

/** Secciones sin entrada propia en el menú: se resaltan bajo la más cercana. */
const ALIAS: Record<string, string> = { calculadora: 'precios', faq: 'demo' };

/** Menú fijo: marca la sección visible, se pliega en celular y cierra con Escape. */
export default function LandingNav() {
  const [active, setActive] = useState('inicio');
  const [open, setOpen] = useState(false);

  // Scroll-spy + progreso en un solo listener (rAF): la sección activa es la última
  // cuyo borde superior ya pasó el 35 % de la altura de la ventana.
  useEffect(() => {
    const ids = [...LINKS.map((l) => l.id), ...Object.keys(ALIAS)];
    const bar = document.getElementById('landing-progress');
    let raf = 0;
    const update = () => {
      const line = window.innerHeight * 0.35;
      let current = LINKS[0].id;
      let best = -Infinity;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top <= line && top > best) {
          best = top;
          current = ALIAS[id] ?? id;
        }
      }
      setActive(current);
      if (bar) {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        bar.style.setProperty('--progress', String(max > 0 ? Math.min(1, window.scrollY / max) : 0));
      }
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header className="poster-dark sticky top-0 z-50 border-b-2 border-[var(--p-red)] bg-[var(--p-ink)]/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-2 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center" aria-label="Mr. Go Assistance, inicio">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/landing/logo.webp" alt="Mr. Go Assistance" width={195} height={59} className="h-10 w-auto sm:h-11" />
        </Link>

        <nav className="hidden items-center gap-1 xl:flex" aria-label="Principal">
          {LINKS.map((l) => (
            <a
              key={l.id}
              href={`#${l.id}`}
              aria-current={active === l.id ? 'true' : undefined}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-base font-semibold uppercase tracking-wide transition-colors ${
                active === l.id
                  ? 'bg-[var(--p-red)] text-[var(--p-paper)]'
                  : 'text-[var(--p-paper)]/80 hover:bg-white/10 hover:text-white'
              }`}
            >
              <l.icon className="h-4 w-4" aria-hidden />
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Link href="/login" className="text-base font-semibold uppercase tracking-wide text-[var(--p-paper)]/80 hover:text-white">
            <span className="sm:hidden">Entrar</span>
            <span className="hidden sm:inline">Iniciar sesión</span>
          </Link>
          <span className="hidden sm:block">
            <Link href="/register" className="poster-btn poster-btn--red !px-4 !py-2 !text-base">
              Empezar gratis
            </Link>
          </span>
          <button
            type="button"
            className="p-2 text-[var(--p-paper)] xl:hidden"
            aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
            aria-expanded={open}
            aria-controls="landing-menu"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      <div id="landing-progress" aria-hidden className="poster-progress absolute inset-x-0 -bottom-[2px] h-[2px] bg-[var(--p-paper)]" />

      {open && (
        <nav id="landing-menu" className="border-t border-[var(--p-line)] bg-[var(--p-ink)] px-4 py-3 xl:hidden" aria-label="Menú móvil">
          <ul className="grid gap-1">
            {LINKS.map((l) => (
              <li key={l.id}>
                <a
                  href={`#${l.id}`}
                  onClick={() => setOpen(false)}
                  aria-current={active === l.id ? 'true' : undefined}
                  className={`flex items-center gap-2 px-3 py-3 text-lg font-semibold uppercase tracking-wide ${
                    active === l.id ? 'bg-[var(--p-red)]' : 'hover:bg-white/10'
                  }`}
                >
                  <l.icon className="h-5 w-5" aria-hidden />
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
