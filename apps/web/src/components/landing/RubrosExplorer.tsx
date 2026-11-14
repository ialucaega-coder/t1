'use client';

import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Utensils,
  Scissors,
  Cross,
  Dumbbell,
  ShoppingCart,
  Wrench,
  Flower2,
  Smile,
  Factory,
  type LucideIcon,
} from 'lucide-react';
import Reveal from './Reveal';

interface Rubro {
  id: string;
  name: string;
  icon: LucideIcon;
  text: string;
  /** Robot oficial del rubro (public/landing/robot-<id>.webp); los demás usan el ícono. */
  robot: boolean;
  /** Lo que hace el robot, en una línea concreta, para el panel de detalle. */
  does: string[];
}

const RUBROS: Rubro[] = [
  { id: 'restaurante', name: 'Restaurante', icon: Utensils, robot: true, text: 'Reservas, pedidos y cobros por WhatsApp y web.', does: ['Toma reservas de mesa y confirma por WhatsApp', 'Recibe pedidos del menú y los cobra', 'Avisa al salón cuando entra un pedido'] },
  { id: 'barberia', name: 'Barbería', icon: Scissors, robot: true, text: 'Turnos automáticos, recordatorios y gestión de agenda.', does: ['Agenda turnos por barbero y servicio', 'Manda recordatorios para evitar ausencias', 'Reprograma y llena huecos de la agenda'] },
  { id: 'farmacia', name: 'Farmacia', icon: Cross, robot: true, text: 'Consultas, pedidos y entregas con atención 24/7.', does: ['Responde consultas de stock y horarios', 'Toma pedidos y coordina la entrega', 'Atiende fuera de horario sin guardias'] },
  { id: 'gimnasio', name: 'Gimnasio', icon: Dumbbell, robot: true, text: 'Altas, turnos, clases y cobros automáticos.', does: ['Da de alta socios y cobra la cuota', 'Reserva lugar en clases y turnos', 'Recuerda vencimientos de membresía'] },
  { id: 'tienda', name: 'Tienda', icon: ShoppingCart, robot: true, text: 'Catálogo, stock, pedidos y ventas por WhatsApp.', does: ['Muestra el catálogo con precios y stock', 'Toma pedidos y genera el link de pago', 'Hace seguimiento de entregas'] },
  { id: 'taller', name: 'Taller', icon: Wrench, robot: true, text: 'Turnos, presupuestos, seguimiento de trabajos y avisos automáticos.', does: ['Agenda turnos de servicio', 'Envía presupuestos para aprobar', 'Avisa cuando el vehículo está listo'] },
  { id: 'spa', name: 'Spa', icon: Flower2, robot: false, text: 'Reservas de tratamientos, packs y recordatorios.', does: ['Reserva tratamientos y profesionales', 'Vende packs y gift cards', 'Recuerda y reconfirma cada turno'] },
  { id: 'dentista', name: 'Dentista', icon: Smile, robot: false, text: 'Turnos, recordatorios y seguimiento de pacientes.', does: ['Agenda consultas y controles', 'Recuerda turnos para reducir faltas', 'Contacta pacientes para revisiones'] },
  { id: 'industria', name: 'Industria', icon: Factory, robot: false, text: 'Pedidos de clientes, cotizaciones y avisos de producción.', does: ['Recibe pedidos y cotizaciones', 'Informa el estado de cada orden', 'Avisa entregas y novedades'] },
];

const EQUIPO = RUBROS.filter((r) => r.robot);

export default function RubrosExplorer({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState('restaurante');
  const tabsRef = useRef<HTMLDivElement>(null);
  const current = RUBROS.find((r) => r.id === selected) ?? RUBROS[0];

  function spot(e: PointerEvent<HTMLElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
  }

  function pickFromCard(id: string) {
    setSelected(id);
    document.getElementById('giros')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function onTabKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = RUBROS.length - 1;
    let next = index;
    if (e.key === 'ArrowRight') next = index === last ? 0 : index + 1;
    else if (e.key === 'ArrowLeft') next = index === 0 ? last : index - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    else return;
    e.preventDefault();
    setSelected(RUBROS[next].id);
    tabsRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }

  return (
    <>
      {/* Equipo por rubro */}
      <section id="equipo" className="poster-stores scroll-mt-16">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <h2 className="poster-display mb-8 text-center text-3xl sm:text-4xl">
          <span className="poster-banner">Tu equipo de robots, según tu negocio</span>
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {EQUIPO.map((r, i) => (
            <Reveal key={r.id} delay={i * 60}>
              <button
                type="button"
                onClick={() => pickFromCard(r.id)}
                onPointerMove={spot}
                aria-pressed={selected === r.id}
                aria-label={`${r.name}: ${r.text} Ver detalle`}
                className="poster-card poster-frame flex min-h-36 items-stretch"
              >
                <span className="block w-2/5 shrink-0 overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/landing/robot-${r.id}.webp`}
                    alt=""
                    width={215}
                    height={115}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </span>
                <span className="flex min-w-0 flex-1 flex-col justify-center gap-1 py-3 pl-4 pr-4">
                  <span className="poster-display flex items-center gap-2 text-2xl sm:text-3xl">
                    <r.icon className="h-6 w-6" aria-hidden /> {r.name}
                  </span>
                  <span className="text-xl leading-tight text-[var(--p-paper)]/90">{r.text}</span>
                </span>
              </button>
            </Reveal>
          ))}
        </div>
        <p className="mt-5 text-center text-lg text-[var(--p-mute)]">Tocá un robot para ver qué hace en tu rubro.</p>
        </div>
      </section>

      {children}

      {/* Giros de negocio (pestañas) */}
      <section id="giros" className="poster-band poster-rays-soft scroll-mt-16">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <h2 className="poster-display mb-6 text-3xl sm:text-4xl">
          <span className="poster-banner">Giros de negocio</span>
        </h2>

        <div ref={tabsRef} role="tablist" aria-label="Giros de negocio" className="poster-frame flex flex-wrap">
          {RUBROS.map((r, i) => (
            <button
              key={r.id}
              type="button"
              role="tab"
              id={`tab-${r.id}`}
              aria-selected={selected === r.id}
              aria-controls="giro-panel"
              tabIndex={selected === r.id ? 0 : -1}
              onClick={() => setSelected(r.id)}
              onKeyDown={(e) => onTabKeyDown(e, i)}
              className={`flex min-w-[5.5rem] flex-1 flex-col items-center gap-1 border-r border-[var(--p-line)] px-2 py-4 text-base font-semibold transition-colors last:border-r-0 ${
                selected === r.id ? 'bg-[var(--p-red)] text-[var(--p-on-red)]' : 'hover:bg-[var(--p-hover)]'
              }`}
            >
              <r.icon className="h-7 w-7" aria-hidden />
              {r.name}
            </button>
          ))}
        </div>

        <div
          id="giro-panel"
          role="tabpanel"
          aria-labelledby={`tab-${current.id}`}
          className="poster-frame mt-4 grid items-center gap-8 p-6 md:grid-cols-[minmax(0,440px)_1fr]"
        >
          <div key={`img-${current.id}`} className="poster-swap overflow-hidden border-2 border-[var(--p-line)] bg-[var(--p-ink)]">
            {current.robot ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={current.id}
                src={`/landing/robot-${current.id}.webp`}
                alt={`Robot asistente de ${current.name.toLowerCase()}`}
                width={215}
                height={115}
                className="aspect-[215/115] w-full object-cover"
              />
            ) : (
              <div className="flex aspect-[215/115] items-center justify-center bg-[var(--p-red-deep)]">
                <current.icon className="h-16 w-16 text-[var(--p-on-red)]" aria-hidden />
              </div>
            )}
          </div>
          <div key={`txt-${current.id}`} className="poster-swap">
            <h3 className="poster-display flex items-center gap-3 text-4xl">
              <current.icon className="h-8 w-8 text-[var(--p-red)]" aria-hidden /> {current.name}
            </h3>
            <p className="mt-2 text-2xl leading-snug text-[var(--p-paper)]/90">{current.text}</p>
            <ul className="mt-3 space-y-1.5">
              {current.does.map((d) => (
                <li key={d} className="flex items-start gap-3 text-xl leading-snug">
                  <span aria-hidden className="mt-2 h-2 w-2 shrink-0 bg-[var(--p-red)]" />
                  {d}
                </li>
              ))}
            </ul>
            <Link href="/register" className="poster-btn poster-btn--red mt-5">
              Empezar con {current.name.toLowerCase()} <ArrowRight className="h-5 w-5" />
            </Link>
          </div>
        </div>
        </div>
      </section>
    </>
  );
}
