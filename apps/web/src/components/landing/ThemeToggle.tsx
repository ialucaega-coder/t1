'use client';

import { useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';
import { parseTheme, themeCookie, type PosterTheme } from './theme';

/** El tema vive en data-poster-theme del contenedor .poster (el servidor lo deja puesto). */
function scope(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.poster');
}

function currentTheme(): PosterTheme {
  return parseTheme(scope()?.getAttribute('data-poster-theme'));
}

function subscribe(onChange: () => void) {
  const el = scope();
  if (!el) return () => {};
  const mo = new MutationObserver(onChange);
  mo.observe(el, { attributes: true, attributeFilter: ['data-poster-theme'] });
  return () => mo.disconnect();
}

/** Interruptor claro / oscuro: aplica el tema al instante y lo recuerda en una cookie. */
export default function ThemeToggle() {
  // En el servidor no hay DOM: null (el ícono correcto lo resuelve el CSS por el atributo).
  const theme = useSyncExternalStore<PosterTheme | null>(subscribe, currentTheme, () => null);

  function toggle() {
    const next: PosterTheme = currentTheme() === 'dark' ? 'light' : 'dark';
    scope()?.setAttribute('data-poster-theme', next);
    document.cookie = themeCookie(next);
  }

  const label = theme === 'dark' ? 'Cambiar a modo claro' : theme === 'light' ? 'Cambiar a modo oscuro' : 'Cambiar tema';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="flex h-10 w-10 items-center justify-center border-2 border-[var(--p-paper)]/40 text-[var(--p-paper)] transition-colors hover:border-[var(--p-paper)] hover:bg-[var(--p-hover)]"
    >
      <Moon className="poster-theme-moon h-5 w-5" aria-hidden />
      <Sun className="poster-theme-sun h-5 w-5" aria-hidden />
    </button>
  );
}
