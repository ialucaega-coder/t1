'use client';

import { useEffect, useRef } from 'react';

/** Arte del hero con parallax suave al mover el mouse (solo punteros finos y sin reduced-motion). */
export function HeroArt() {
  const ref = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const img = ref.current;
    if (!img) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!window.matchMedia('(pointer: fine)').matches) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const x = (e.clientX / window.innerWidth - 0.5) * 2;
        const y = (e.clientY / window.innerHeight - 0.5) * 2;
        img.style.transform = `scale(1.05) translate(${(-x * 10).toFixed(1)}px, ${(-y * 6).toFixed(1)}px)`;
      });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={ref}
        src="/landing/hero-art.webp"
        alt="Mr. Go y su gato mascota frente a un restaurante, una barbería, una farmacia y un gimnasio"
        width={1024}
        height={268}
        fetchPriority="high"
        className="poster-hero-fade poster-hero-art mx-auto block h-auto w-full max-w-[1280px]"
      />
    </div>
  );
}
