'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Aparece al entrar en pantalla. Sin JS (o con prefers-reduced-motion) el contenido
 * queda visible: solo se oculta DESPUÉS de montar y solo si está debajo del pliegue.
 */
export default function Reveal({
  children,
  className = '',
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight) return; // ya visible: no animar

    el.classList.add('reveal-pending');
    if (delay) el.style.transitionDelay = `${delay}ms`;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add('reveal-in');
          io.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [delay]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
