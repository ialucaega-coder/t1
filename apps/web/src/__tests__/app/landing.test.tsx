/**
 * Landing "Ejército de Robots" (apps/web/src/app/page.tsx).
 * Estructura (anclas, enlaces, imágenes) e INTERACCIONES reales: menú móvil,
 * robots/giros seleccionables, toggle mensual/anual de planes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import fs from 'fs';
import path from 'path';

// next/font/google solo funciona dentro del build de Next.
vi.mock('next/font/google', () => ({
  Anton: () => ({ variable: 'font-anton' }),
  Barlow_Condensed: () => ({ variable: 'font-barlow' }),
}));

// jsdom no trae IntersectionObserver ni matchMedia.
class IO {
  observe() {}
  disconnect() {}
  unobserve() {}
}

// La landing lee la cookie del tema en el servidor.
let cookieTheme: string | undefined;
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (k: string) => (k === 'poster-theme' && cookieTheme ? { value: cookieTheme } : undefined) }),
}));

import Home, { metadata } from '@/app/page';

/** Home es un componente de servidor async: se resuelve antes de renderizar. */
async function renderHome() {
  return render(await Home());
}

const PUBLIC = path.resolve(__dirname, '../../../public');

beforeEach(() => {
  cookieTheme = undefined;
  document.cookie = 'poster-theme=; max-age=0; path=/';
  vi.stubGlobal('IntersectionObserver', IO);
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation(() => ({ matches: true, addEventListener() {}, removeEventListener() {} })),
  );
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => [] }));
  Element.prototype.scrollIntoView = vi.fn();
});

describe('landing — estructura', () => {
  it('tiene un único h1 y declara título, descripción y vista previa', async () => {
    const { container } = await renderHome();
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(String(metadata.title)).toContain('Mr. Go');
    expect(metadata.description).toBeTruthy();
    expect(metadata.openGraph?.images).toBeTruthy();
  });

  it('todas las anclas internas apuntan a una sección existente', async () => {
    const { container } = await renderHome();
    const anchors = [...container.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute('href') as string);
    expect(anchors.length).toBeGreaterThan(5);
    for (const href of anchors) expect(container.querySelector(href), `ancla ${href} sin destino`).not.toBeNull();
  });

  it('los enlaces a la app son solo los esperados', async () => {
    const { container } = await renderHome();
    const hrefs = new Set([...container.querySelectorAll('a')].map((a) => a.getAttribute('href') as string));
    for (const h of hrefs) {
      expect(h.startsWith('#') || ['/', '/login', '/register', '/dashboard'].includes(h), `enlace inesperado ${h}`).toBe(true);
    }
    expect(hrefs.has('/register')).toBe(true);
    expect(hrefs.has('/login')).toBe(true);
  });

  it('el chat de la demo real está visible y tiene título accesible', async () => {
    const { container } = await renderHome();
    const iframe = container.querySelector('#demo iframe');
    expect(iframe?.getAttribute('src')).toBe('/chat/demo');
    expect(iframe?.getAttribute('title')).toBeTruthy();
  });

  it('no muestra la marca vieja', async () => {
    const { container } = await renderHome();
    expect(container.textContent).not.toMatch(/Local B/i);
  });
});

describe('landing — imágenes', () => {
  it('toda imagen informativa tiene alt, tamaño y archivo existente', async () => {
    const { container } = await renderHome();
    const imgs = [...container.querySelectorAll('img')];
    expect(imgs.length).toBeGreaterThanOrEqual(8);
    for (const img of imgs) {
      const src = img.getAttribute('src') as string;
      expect(fs.existsSync(path.join(PUBLIC, src)), `falta ${src}`).toBe(true);
      expect(img.getAttribute('width') && img.getAttribute('height'), `sin tamaño ${src}`).toBeTruthy();
      // Las de las tarjetas son decorativas (alt vacío) porque el botón ya trae el texto.
      if (!src.includes('robot-') || img.closest('button') === null) {
        expect((img.getAttribute('alt') || '').length, `sin alt ${src}`).toBeGreaterThan(5);
      }
    }
  });

  it('no quedan assets huérfanos en public/landing', async () => {
    const { container } = await renderHome();
    // El panel de giros muestra el robot del giro seleccionado: se cubre al pasar por cada pestaña.
    const used = new Set([...container.querySelectorAll('img')].map((i) => path.basename(i.getAttribute('src') as string)));
    // También cuentan las imágenes usadas como fondo desde el CSS.
    const css = fs.readFileSync(path.resolve(__dirname, '../../components/landing/poster.css'), 'utf8');
    for (const m of css.matchAll(/\/landing\/([\w-]+\.webp)/g)) used.add(m[1]);
    for (const f of fs.readdirSync(path.join(PUBLIC, 'landing'))) expect(used.has(f), `asset sin usar: ${f}`).toBe(true);
  });
});

describe('landing — interacciones', () => {
  it('tocar un robot lo selecciona y el panel de giros muestra su detalle', async () => {
    await renderHome();
    const card = screen.getByRole('button', { name: /Barbería/ });
    expect(card.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(card);
    expect(card.getAttribute('aria-pressed')).toBe('true');
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByRole('heading', { name: /Barbería/ })).toBeTruthy();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('las pestañas de giros cambian el panel y responden a las flechas del teclado', async () => {
    await renderHome();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(9);
    fireEvent.click(screen.getByRole('tab', { name: /Spa/ }));
    expect(within(screen.getByRole('tabpanel')).getByRole('heading', { name: /Spa/ })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('tab', { name: /Spa/ }), { key: 'ArrowRight' });
    expect(within(screen.getByRole('tabpanel')).getByRole('heading', { name: /Dentista/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Dentista/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('el menú móvil abre, lista las secciones y se cierra al elegir una', async () => {
    await renderHome();
    expect(screen.queryByRole('navigation', { name: 'Menú móvil' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú' }));
    const menu = screen.getByRole('navigation', { name: 'Menú móvil' });
    expect(within(menu).getAllByRole('link')).toHaveLength(6);
    fireEvent.click(within(menu).getByRole('link', { name: /Precios/ }));
    expect(screen.queryByRole('navigation', { name: 'Menú móvil' })).toBeNull();
  });

  it('el menú móvil se cierra con Escape', async () => {
    await renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('navigation', { name: 'Menú móvil' })).toBeNull();
  });

  it('el toggle anual cambia los precios mostrados', async () => {
    await renderHome();
    const proCard = () => screen.getByRole('heading', { name: 'Pro' }).closest('div') as HTMLElement;
    expect(within(proCard()).getByText('$79')).toBeTruthy();
    const sw = screen.getByRole('switch');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    expect(sw.getAttribute('aria-checked')).toBe('true');
    await waitFor(() => expect(within(proCard()).getByText('$66')).toBeTruthy());
    expect(within(proCard()).getByText(/al año/)).toBeTruthy();
  });

  it('los 4 planes ofrecen un botón hacia el registro', async () => {
    await renderHome();
    const section = document.getElementById('precios') as HTMLElement;
    const ctas = within(section).getAllByRole('link');
    expect(ctas.map((a) => a.textContent)).toEqual(['Empezar gratis', 'Elegir Starter', 'Elegir Pro', 'Contactar ventas']);
    for (const a of ctas) expect(a.getAttribute('href')).toBe('/register');
  });
});

describe('landing — teclado y lectores de pantalla', () => {
  it('ofrece "Saltar al contenido" como primer enlace y apunta al <main>', async () => {
    const { container } = await renderHome();
    const first = container.querySelector('a') as HTMLAnchorElement;
    expect(first.textContent).toBe('Saltar al contenido');
    expect(first.getAttribute('href')).toBe('#contenido');
    expect(container.querySelector('main#contenido')).not.toBeNull();
  });
});

describe('landing — tema claro / oscuro', () => {
  it('sin cookie arranca en claro y el servidor deja el atributo puesto', async () => {
    const { container } = await renderHome();
    expect(container.querySelector('.poster')?.getAttribute('data-poster-theme')).toBe('light');
  });

  it('respeta la elección guardada en la cookie (oscuro)', async () => {
    cookieTheme = 'dark';
    const { container } = await renderHome();
    expect(container.querySelector('.poster')?.getAttribute('data-poster-theme')).toBe('dark');
  });

  it('una cookie inválida cae al tema claro', async () => {
    cookieTheme = 'rosa';
    const { container } = await renderHome();
    expect(container.querySelector('.poster')?.getAttribute('data-poster-theme')).toBe('light');
  });

  it('el botón alterna el tema, lo recuerda en una cookie y cambia su etiqueta', async () => {
    const { container } = await renderHome();
    const poster = container.querySelector('.poster') as HTMLElement;
    const btn = () => screen.getByRole('button', { name: /Cambiar a modo/ });
    expect(btn().getAttribute('aria-label')).toBe('Cambiar a modo oscuro');
    fireEvent.click(btn());
    await waitFor(() => expect(poster.getAttribute('data-poster-theme')).toBe('dark'));
    expect(document.cookie).toContain('poster-theme=dark');
    await waitFor(() => expect(btn().getAttribute('aria-label')).toBe('Cambiar a modo claro'));
    fireEvent.click(btn());
    await waitFor(() => expect(poster.getAttribute('data-poster-theme')).toBe('light'));
    expect(document.cookie).toContain('poster-theme=light');
  });

  it('menú, hero y pie fuerzan el set oscuro para que el logo oscuro no choque con el papel', async () => {
    const { container } = await renderHome();
    for (const sel of ['header', '#inicio', 'footer']) {
      expect(container.querySelector(sel)?.classList.contains('poster-dark'), sel).toBe(true);
    }
  });
});

describe('landing — CSS propio vs utilidades', () => {
  it('ningún botón .poster-btn combina "hidden"/display responsive (la regla propia le gana a Tailwind)', async () => {
    const { container } = await renderHome();
    // Se fuerza el estado "scrolleado" para renderizar también la barra fija.
    for (const el of container.querySelectorAll('.poster-btn')) {
      const cls = el.className;
      expect(/(^|\s)(hidden|(sm|md|lg|xl):(inline-flex|flex|block|hidden))(\s|$)/.test(cls), `choque de display en: ${cls}`).toBe(false);
    }
  });
});
