'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ArrowUp } from 'lucide-react';

/** Tras el hero: barra "Empezar gratis" en celular y botón "volver arriba" en pantallas grandes. */
export default function StickyCta() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 700);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (!show) return null;
  return (
    <>
      <div className="poster-slide-up fixed inset-x-0 bottom-0 z-40 border-t-2 border-[var(--p-red)] bg-[var(--p-ink)]/95 p-3 backdrop-blur md:hidden">
        <Link href="/register" className="poster-btn poster-btn--red w-full">
          Empezar gratis <ArrowRight className="h-5 w-5" />
        </Link>
      </div>
      <div className="fixed bottom-6 right-6 z-40 hidden md:block">
        <button
          type="button"
          aria-label="Volver arriba"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="poster-slide-up poster-btn poster-btn--red !p-3"
        >
          <ArrowUp className="h-6 w-6" />
        </button>
      </div>
    </>
  );
}
