'use client';

// PostHog — analitica de producto (client-side).
//
// Patron identico al de Sentry: NO hace absolutamente nada si la env
// `NEXT_PUBLIC_POSTHOG_KEY` no esta seteada. Asi el build y el runtime
// nunca dependen de tener una clave configurada (util en dev/CI/preview).
//
// Se integra en el layout raiz envolviendo la app. Captura pageviews
// manualmente en cada cambio de ruta del App Router de Next.js.

import { useEffect, Suspense, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import posthog from 'posthog-js';
import { PostHogProvider as PHProvider } from 'posthog-js/react';

// Solo hay analitica si existe la clave publica. Se evalua una unica vez.
const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';
const isEnabled = typeof POSTHOG_KEY === 'string' && POSTHOG_KEY.length > 0;

// Inicializa PostHog una sola vez del lado del cliente.
function initPostHog() {
  if (!isEnabled || typeof window === 'undefined') return;
  if (posthog.__loaded) return; // evita doble init en Fast Refresh / re-render

  posthog.init(POSTHOG_KEY as string, {
    api_host: POSTHOG_HOST,
    // Capturamos pageviews manualmente (App Router no dispara navegacion full-page).
    capture_pageview: false,
    // Captura automatica de clicks/inputs; se puede desactivar si se prefiere.
    autocapture: true,
    // Respeta la configuracion "Do Not Track" del navegador.
    respect_dnt: true,
  });
}

// Componente interno que escucha los cambios de ruta y captura pageviews.
// Va dentro de <Suspense> porque useSearchParams() lo requiere en build.
function PostHogPageview() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!isEnabled) return;

    let url = window.origin + pathname;
    const qs = searchParams?.toString();
    if (qs) url += `?${qs}`;

    posthog.capture('$pageview', { $current_url: url });
  }, [pathname, searchParams]);

  return null;
}

export function PostHogProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    initPostHog();
  }, []);

  // Sin clave: no cargamos nada, solo devolvemos los hijos tal cual.
  if (!isEnabled) {
    return <>{children}</>;
  }

  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PostHogPageview />
      </Suspense>
      {children}
    </PHProvider>
  );
}
