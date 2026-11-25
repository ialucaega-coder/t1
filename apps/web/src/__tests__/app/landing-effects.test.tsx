/**
 * Efectos y funcionalidades extra de la landing: calculadora de ahorro, FAQ,
 * parallax, botón fijo y respeto de prefers-reduced-motion.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import fs from 'fs';
import path from 'path';

import { computeRoi, recommendPlan, PLANS } from '@/components/landing/roi';
import RoiCalculator from '@/components/landing/RoiCalculator';
import Faq, { FAQ_ITEMS } from '@/components/landing/Faq';
import { HeroArt } from '@/components/landing/HeroMotion';
import StickyCta from '@/components/landing/StickyCta';
import Marquee from '@/components/landing/Marquee';

function mockMotion(reduced: boolean, fine = true) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((q: string) => ({
      matches: q.includes('reduce') ? reduced : q.includes('pointer: fine') ? fine : false,
      addEventListener() {},
      removeEventListener() {},
    })),
  );
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} unobserve() {} });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('calculadora — cuentas', () => {
  it('horas y dinero salen de consultas × minutos × % automático', () => {
    // 60/día × 30 = 1800 msj/mes; 1800 × 4 min × 60% = 4320 min = 72 h; × $8 = $576
    const r = computeRoi({ perDay: 60, minutes: 4, hourValue: 8, autoPct: 60 });
    expect(r.messagesPerMonth).toBe(1800);
    expect(r.hoursSaved).toBe(72);
    expect(r.moneySaved).toBe(576);
    expect(r.plan.name).toBe('Starter');
    expect(r.net).toBe(576 - 29);
  });

  it('recomienda el plan por mensajes/mes con los topes de los planes publicados', () => {
    expect(recommendPlan(500).name).toBe('Gratis');
    expect(recommendPlan(501).name).toBe('Starter');
    expect(recommendPlan(5000).name).toBe('Starter');
    expect(recommendPlan(5001).name).toBe('Pro');
    expect(recommendPlan(25000).name).toBe('Pro');
    expect(recommendPlan(25001).name).toBe('Enterprise');
    expect(PLANS.map((p) => p.price)).toEqual([0, 29, 79, 199]);
  });

  it('valores negativos o vacíos no rompen la cuenta', () => {
    const r = computeRoi({ perDay: -5, minutes: -1, hourValue: -9, autoPct: 0 });
    expect(r.hoursSaved).toBe(0);
    expect(r.moneySaved).toBe(0);
    expect(r.plan.name).toBe('Gratis');
  });
});

describe('calculadora — interacción', () => {
  it('mover un slider recalcula horas, dinero y plan recomendado', () => {
    mockMotion(true);
    render(<RoiCalculator />);
    expect(screen.getByTestId('roi-hours').textContent).toContain('72');
    expect(screen.getByTestId('roi-plan').textContent).toBe('Starter');
    fireEvent.change(screen.getByLabelText('Consultas por día'), { target: { value: '400' } });
    expect(screen.getByTestId('roi-hours').textContent).toContain('480');
    expect(screen.getByTestId('roi-plan').textContent).toBe('Pro');
    expect(screen.getByRole('link', { name: /Empezar con Pro/ }).getAttribute('href')).toBe('/register');
  });

  it('aclara que el % que resuelve el robot es un supuesto editable', () => {
    mockMotion(true);
    render(<RoiCalculator />);
    expect(screen.getByText(/supuesto tuyo/i)).toBeTruthy();
  });
});

describe('FAQ', () => {
  it('es un acordeón accesible (details exclusivos) con todas las preguntas', () => {
    mockMotion(true);
    const { container } = render(<Faq />);
    const items = container.querySelectorAll('details');
    expect(items).toHaveLength(FAQ_ITEMS.length);
    for (const d of items) expect(d.getAttribute('name')).toBe('faq');
    expect(container.textContent).not.toMatch(/Local B/i);
  });
});

describe('efectos con movimiento habilitado', () => {
  it('el parallax mueve el arte del hero con el puntero', () => {
    mockMotion(false, true);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    render(<HeroArt />);
    const img = screen.getByRole('img') as HTMLImageElement;
    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 0, clientY: 0 }));
    });
    expect(img.style.transform).toContain('scale(1.05)');
  });

  it('el botón fijo aparece tras scrollear y "volver arriba" funciona', () => {
    mockMotion(false);
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
    render(<StickyCta />);
    expect(screen.queryByRole('button', { name: 'Volver arriba' })).toBeNull();
    Object.defineProperty(window, 'scrollY', { value: 1200, configurable: true });
    act(() => void window.dispatchEvent(new Event('scroll')));
    expect(screen.getByRole('link', { name: /Empezar gratis/ }).getAttribute('href')).toBe('/register');
    fireEvent.click(screen.getByRole('button', { name: 'Volver arriba' }));
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  });

  it('con reduced-motion el parallax no se activa', () => {
    mockMotion(true);
    render(<HeroArt />);
    act(() => void window.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 50 })));
    expect((screen.getByRole('img') as HTMLImageElement).style.transform).toBe('');
  });
});

describe('cinta de rubros y CSS', () => {
  it('la cinta duplica su contenido (oculto a lectores) para el loop continuo', () => {
    const { container } = render(<Marquee />);
    expect(container.querySelectorAll('ul')).toHaveLength(2);
    expect(container.querySelectorAll('ul[aria-hidden="true"]')).toHaveLength(1);
  });

  it('los fondos de locales del CSS apuntan a archivos que existen y se ocultan en celular', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '../../components/landing/poster.css'), 'utf8');
    const files = [...css.matchAll(/\/landing\/([\w-]+\.webp)/g)].map((m) => m[1]);
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const name of files) expect(fs.existsSync(path.resolve(__dirname, '../../../public/landing', name)), name).toBe(true);
    expect(css).toMatch(/@media \(max-width: 767px\)\s*\{\s*\.poster-stores::before/);
  });

  it('el CSS define las animaciones y las apaga con prefers-reduced-motion', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '../../components/landing/poster.css'), 'utf8');
    for (const k of ['poster-marquee', 'poster-swap', 'poster-slide-up', 'poster-slam']) {
      expect(css).toContain(`@keyframes ${k}`);
    }
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.poster-marquee-track');
    expect(reduced).toContain('animation: none');
  });
});

describe('menú — sección activa y progreso', () => {
  it('marca la última sección que pasó el 35 % de la ventana y mapea calculadora/FAQ', async () => {
    const { default: LandingNav } = await import('@/components/landing/LandingNav');
    mockMotion(true);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    const tops: Record<string, number> = { inicio: -900, equipo: -400, 'como-funciona': 200, giros: 900, calculadora: 1400, precios: 1900, faq: 2400, demo: 2900 };
    for (const [id, top] of Object.entries(tops)) {
      const el = document.createElement('section');
      el.id = id;
      el.getBoundingClientRect = () => ({ top, bottom: top + 500, left: 0, right: 0, width: 0, height: 500, x: 0, y: top, toJSON() {} }) as DOMRect;
      document.body.appendChild(el);
    }
    render(<LandingNav />);
    expect(screen.getByRole('link', { name: /Cómo funciona/ }).getAttribute('aria-current')).toBe('true');

    const move = (shift: number) => {
      for (const [id, top] of Object.entries(tops)) {
        const el = document.getElementById(id) as HTMLElement;
        el.getBoundingClientRect = () => ({ top: top - shift, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} }) as DOMRect;
      }
      act(() => void window.dispatchEvent(new Event('scroll')));
    };
    move(1300); // calculadora queda arriba de la línea -> se resalta "Precios"
    expect(screen.getByRole('link', { name: /Precios/ }).getAttribute('aria-current')).toBe('true');
    move(2300); // faq -> se resalta "Demo"
    expect(screen.getByRole('link', { name: /^Demo$/ }).getAttribute('aria-current')).toBe('true');
    move(0);
    expect(screen.getByRole('link', { name: /Cómo funciona/ }).getAttribute('aria-current')).toBe('true');

    for (const id of Object.keys(tops)) document.getElementById(id)?.remove();
  });
});
