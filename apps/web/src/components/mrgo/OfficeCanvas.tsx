'use client';

/**
 * OfficeCanvas — "La oficina, en vivo".
 *
 * La oficina de Mr Go como escena viva: una sala cálida donde cada agente está
 * en su escritorio con su laptop (glow cuando trabaja), su mascota al lado y una
 * etiqueta con nombre + rol. El CEO ocupa el puesto de dirección arriba.
 *
 * Vida ambiente (inspirada en la oficina de Munder Difflin, que tiene avatares
 * con estados idle/working/walking, café, boardroom y sobres que vuelan de
 * escritorio en escritorio): acá los avatares respiran/flotan (ver MrGoAvatar),
 * las laptops laten, un sobre cruza la sala cada tanto y de vez en cuando un
 * agente que trabaja tira una frase. Es funcional: clic en un puesto abre el
 * panel del agente (estado, tools, darle una orden, pausar/reactivar).
 *
 * 100% CSS/divs (sin Pixi ni dependencias): liviano, responsive y encaja en el
 * panel oscuro como un "escenario" cálido.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Send, Pause, Play, Wrench, X } from 'lucide-react';
import { MrGoAvatar } from './MrGoAvatar';
import {
  MR_GO_PETS,
  type MrGoColorKey,
  type MrGoEmotion,
  type MrGoPetKey,
} from './types';

export interface OfficeDesk {
  key: string;
  nombre: string;
  rol: string;
  color: MrGoColorKey;
  emotion: MrGoEmotion;
  pet?: MrGoPetKey;
  highlighted?: boolean;
  director?: boolean;
  /** Tools que el agente puede ejecutar (para el panel). */
  tools?: string[];
  /** Si está pausado (se atenúa y deja de "trabajar"). */
  paused?: boolean;
}

export interface OfficeCanvasProps {
  desks: OfficeDesk[];
  director?: OfficeDesk | null;
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
  /** Darle una orden directa a un agente (abre/enfoca el comando con su nombre). */
  onOrderAgent?: (key: string) => void;
  /** Pausar / reactivar un agente. */
  onTogglePause?: (key: string) => void;
  className?: string;
}

// Frases ambiente que tiran los agentes trabajando (vida de oficina).
const QUIPS = [
  'Cerrando esta reserva…',
  'Le mando el link de pago.',
  '¿Alguien vio la caja de hoy?',
  'Respondiendo el DM de Instagram.',
  'Agendando el turno de las 15.',
  'Armo el reporte y aviso.',
  'Este cliente ya está en Hot 🔥',
  'Voy por un café ☕ y sigo.',
  'Confirmando la seña por WhatsApp.',
  'Campaña lista para salir.',
];

export function OfficeCanvas({
  desks,
  director,
  selectedKey,
  onSelect,
  onOrderAgent,
  onTogglePause,
  className,
}: OfficeCanvasProps) {
  const allDesks = useMemo(
    () => (director ? [director, ...desks] : desks),
    [director, desks],
  );

  // Frase ambiente: cada ~5s elige un agente "trabajando" y le muestra un quip.
  const [quip, setQuip] = useState<{ key: string; text: string } | null>(null);
  const quipRef = useRef(quip);
  quipRef.current = quip;
  useEffect(() => {
    const workers = allDesks.filter((d) => d.emotion === 'working' && !d.paused);
    if (workers.length === 0) {
      setQuip(null);
      return;
    }
    const tick = () => {
      // 60% de las veces muestra uno nuevo; si no, descansa (silencio).
      if (Math.random() < 0.6) {
        const d = workers[Math.floor(Math.random() * workers.length)];
        setQuip({ key: d.key, text: QUIPS[Math.floor(Math.random() * QUIPS.length)] });
        setTimeout(() => {
          setQuip((q) => (q && q.key === d.key ? null : q));
        }, 3200);
      } else {
        setQuip(null);
      }
    };
    const id = setInterval(tick, 5000);
    const warm = setTimeout(tick, 1200);
    return () => {
      clearInterval(id);
      clearTimeout(warm);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDesks.map((d) => `${d.key}:${d.emotion}:${d.paused}`).join('|')]);

  const selected = selectedKey ? allDesks.find((d) => d.key === selectedKey) ?? null : null;

  return (
    <div className={className}>
      <div
        style={{
          position: 'relative',
          borderRadius: 18,
          padding: '34px 18px 26px',
          overflow: 'hidden',
          background: 'linear-gradient(180deg, #2a2342 0%, #342a52 42%, #3f3560 100%)',
          border: '1px solid rgba(168,120,247,0.25)',
        }}
      >
        {/* Decoración de sala (clip propio; NO recorta a los avatares) */}
        <div aria-hidden style={{ position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: 18 }}>
          {/* piso */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: '44%',
              background:
                'linear-gradient(180deg, rgba(245,240,255,0.05) 0%, rgba(245,240,255,0.12) 100%)',
              borderTop: '1px solid rgba(168,120,247,0.18)',
            }}
          />
          {/* ventanal */}
          <div
            style={{
              position: 'absolute',
              top: 16,
              left: 20,
              width: 110,
              height: 66,
              borderRadius: 10,
              background: 'linear-gradient(135deg, rgba(126,200,227,0.25), rgba(168,120,247,0.12))',
              border: '2px solid rgba(255,255,255,0.12)',
              boxShadow: 'inset 0 0 0 6px rgba(42,35,66,0.5)',
            }}
          />
          {/* rincón café ☕ */}
          <div style={{ position: 'absolute', top: 18, right: 18, fontSize: 22, opacity: 0.8 }}>☕</div>
          {/* planta 🪴 */}
          <div style={{ position: 'absolute', bottom: 10, left: 12, fontSize: 24, opacity: 0.85 }}>🪴</div>
          {/* sobre que vuela de un lado al otro (mailbox) */}
          <div
            style={{
              position: 'absolute',
              top: '38%',
              left: 0,
              fontSize: 18,
              animation: 'mrgo-envelope 9s linear infinite',
            }}
          >
            ✉️
          </div>
        </div>

        <style>{`
          @keyframes mrgo-envelope {
            0% { transform: translate(-30px, 0) rotate(-6deg); opacity: 0; }
            8% { opacity: .9; }
            50% { transform: translate(46vw, -14px) rotate(6deg); opacity: .9; }
            92% { opacity: .9; }
            100% { transform: translate(92vw, 0) rotate(-4deg); opacity: 0; }
          }
          @media (prefers-reduced-motion: reduce) {
            [style*="mrgo-envelope"] { animation: none !important; opacity: 0 !important; }
          }
        `}</style>

        {/* Puesto de dirección (CEO) */}
        {director && (
          <div style={{ position: 'relative', display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
            <DeskStation
              desk={{ ...director, director: true }}
              selected={selectedKey === director.key}
              quip={quip?.key === director.key ? quip.text : null}
              onSelect={onSelect}
              big
            />
          </div>
        )}

        {/* Equipo */}
        <div
          style={{
            position: 'relative',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 16,
            justifyContent: 'center',
          }}
        >
          {desks.map((d) => (
            <DeskStation
              key={d.key}
              desk={d}
              selected={selectedKey === d.key}
              quip={quip?.key === d.key ? quip.text : null}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>

      {/* Panel del agente seleccionado (funcional) */}
      {selected && (
        <AgentPanel
          desk={selected}
          onClose={() => onSelect?.(selected.key)}
          onOrder={onOrderAgent ? () => onOrderAgent(selected.key) : undefined}
          onTogglePause={onTogglePause ? () => onTogglePause(selected.key) : undefined}
        />
      )}
    </div>
  );
}

/** Un puesto: escritorio + laptop (glow si trabaja) + Mr Go + mascota + etiqueta + quip. */
function DeskStation({
  desk,
  selected,
  quip,
  onSelect,
  big = false,
}: {
  desk: OfficeDesk;
  selected: boolean;
  quip: string | null;
  onSelect?: (key: string) => void;
  big?: boolean;
}) {
  const paused = Boolean(desk.paused);
  const working = desk.emotion === 'working' && !paused;
  const avatarSize = big ? 104 : 72;
  const deskW = big ? 176 : 128;
  const clickable = Boolean(onSelect);

  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? () => onSelect!(desk.key) : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect!(desk.key);
              }
            }
          : undefined
      }
      aria-label={`${desk.nombre} — ${desk.rol}${paused ? ' (pausado)' : ''}`}
      style={{
        position: 'relative',
        width: deskW,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '6px 8px 10px',
        borderRadius: 14,
        cursor: clickable ? 'pointer' : 'default',
        transition: 'transform .15s ease, box-shadow .15s ease',
        transform: selected || desk.highlighted ? 'translateY(-2px)' : 'none',
        boxShadow:
          selected || desk.highlighted
            ? '0 0 0 2px rgba(168,120,247,0.9), 0 10px 24px rgba(168,120,247,0.25)'
            : 'none',
        background: selected || desk.highlighted ? 'rgba(168,120,247,0.08)' : 'transparent',
        opacity: paused ? 0.55 : 1,
      }}
    >
      {/* Globo de frase (quip) */}
      {quip && (
        <div
          style={{
            position: 'absolute',
            top: -14,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 5,
            padding: '3px 9px',
            borderRadius: 12,
            background: '#fff',
            color: '#1b1530',
            fontSize: 11,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            maxWidth: 190,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
          }}
        >
          {quip}
        </div>
      )}

      {/* Etiqueta */}
      <div
        style={{
          marginBottom: 2,
          padding: '2px 8px',
          borderRadius: 999,
          background: 'rgba(15,12,28,0.72)',
          border: '1px solid rgba(168,120,247,0.3)',
          fontSize: big ? 12 : 11,
          fontWeight: 600,
          color: '#fff',
          whiteSpace: 'nowrap',
          maxWidth: deskW,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {desk.nombre}
      </div>
      <div style={{ fontSize: 10, color: 'rgba(226,220,245,0.65)', marginBottom: 2, textAlign: 'center', lineHeight: 1.1 }}>
        {paused ? 'En pausa' : desk.rol}
      </div>

      {/* Avatar sentado (base detrás del frente del escritorio) */}
      <div style={{ position: 'relative', zIndex: 1, marginBottom: -Math.round(avatarSize * 0.2) }}>
        <MrGoAvatar
          color={desk.color}
          emotion={paused ? 'sleepy' : desk.emotion}
          size={avatarSize}
          pet={Boolean(desk.pet)}
          petKey={desk.pet}
          alive={!paused}
          label={`${desk.nombre} (${desk.rol})`}
        />
      </div>

      {/* Escritorio + laptop */}
      <div style={{ position: 'relative', zIndex: 2, width: deskW - 16 }}>
        <div
          style={{
            height: 10,
            borderRadius: '8px 8px 2px 2px',
            background: desk.director
              ? 'linear-gradient(180deg,#b58af0,#8b5cf6)'
              : 'linear-gradient(180deg,#6b5a8a,#4b3f66)',
          }}
        />
        <div
          style={{
            height: big ? 18 : 14,
            borderRadius: '0 0 8px 8px',
            background: desk.director
              ? 'linear-gradient(180deg,#8b5cf6,#6d28d9)'
              : 'linear-gradient(180deg,#4b3f66,#352c4d)',
            position: 'relative',
          }}
        >
          <div
            aria-hidden
            style={{
              position: 'absolute',
              top: -7,
              left: '50%',
              transform: 'translateX(-50%)',
              width: big ? 30 : 24,
              height: big ? 20 : 16,
              borderRadius: 3,
              background: '#1b1530',
              border: '1px solid rgba(255,255,255,0.18)',
              boxShadow: working ? `0 0 10px 2px rgba(126,200,227,0.7)` : 'none',
              transition: 'box-shadow .3s',
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 2,
                borderRadius: 2,
                background: working
                  ? 'linear-gradient(135deg,#7ec8e3,#a855f7)'
                  : 'rgba(126,200,227,0.22)',
                animation: working ? 'mrgo-screen 2.2s ease-in-out infinite' : undefined,
              }}
            />
          </div>
        </div>
      </div>

      <style>{`
        @keyframes mrgo-screen { 0%,100%{opacity:.78} 50%{opacity:1} }
      `}</style>
    </div>
  );
}

/** Panel funcional del agente seleccionado: estado, tools y acciones. */
function AgentPanel({
  desk,
  onClose,
  onOrder,
  onTogglePause,
}: {
  desk: OfficeDesk;
  onClose: () => void;
  onOrder?: () => void;
  onTogglePause?: () => void;
}) {
  const paused = Boolean(desk.paused);
  const estado = paused ? 'En pausa' : desk.emotion === 'working' ? 'Trabajando' : 'Disponible';
  const estadoCls = paused
    ? 'bg-slate-500/10 text-slate-400 border-slate-500/20'
    : desk.emotion === 'working'
      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
      : 'bg-sky-500/10 text-sky-300 border-sky-500/20';

  return (
    <div className="mt-3 rounded-xl border border-brand-400/40 bg-slate-900/60 p-4">
      <div className="flex items-start gap-3">
        <div className="shrink-0">
          <MrGoAvatar color={desk.color} emotion={paused ? 'sleepy' : desk.emotion} size={56} pet petKey={desk.pet} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="truncate text-sm font-semibold text-white">{desk.nombre}</h3>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar panel del agente"
              className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-xs text-slate-400">{desk.rol}</p>
          <span
            className={`mt-1 inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${estadoCls}`}
          >
            {estado}
          </span>

          {desk.pet && (
            <p className="mt-2 text-[11px] text-slate-500">
              Mascota: <span className="text-slate-300">{MR_GO_PETS[desk.pet].nombre}</span> · {MR_GO_PETS[desk.pet].rol}
            </p>
          )}

          {desk.tools && desk.tools.length > 0 && (
            <div className="mt-2">
              <span className="text-[10px] uppercase tracking-wide text-slate-500">Puede ejecutar</span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {desk.tools.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-[10px] text-amber-300"
                  >
                    <Wrench className="h-2.5 w-2.5 text-amber-400" />
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {onOrder && (
              <button
                type="button"
                onClick={onOrder}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-400 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-500"
              >
                <Send className="h-3.5 w-3.5" />
                Darle una orden
              </button>
            )}
            {onTogglePause && (
              <button
                type="button"
                onClick={onTogglePause}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700"
              >
                {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                {paused ? 'Reactivar' : 'Pausar'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Helper: la mascota sugerida por rol (para armar los desks desde afuera). */
export function petForRole(roleKey: string): MrGoPetKey | undefined {
  const map: Record<string, MrGoPetKey> = {
    ceo: 'jinx',
    inbox: 'rayito',
    soporte: 'rayito',
    reservas: 'relojito',
    cobros: 'billetin',
    finanzas: 'billetin',
    analitica: 'cerebrito',
    operaciones: 'cerebrito',
    marketing: 'megafonito',
    campanas: 'megafonito',
  };
  const pet = map[roleKey];
  return pet && pet in MR_GO_PETS ? pet : undefined;
}
