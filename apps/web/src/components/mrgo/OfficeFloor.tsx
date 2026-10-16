'use client';

/**
 * OfficeFloor — la oficina de Mr Go como un PLANO ESPACIAL CENITAL (top-down),
 * al estilo de Munder Difflin / AI Town pero adaptado a los Mr Go clay.
 *
 * A diferencia de la grilla de tarjetas (que no era "espacial"), acá el piso es
 * un MAPA: hay salas separadas por paredes (Dirección, Café, Sala de reunión),
 * zonas de departamento con sus escritorios como muebles, y cada agente está
 * UBICADO POR COORDENADAS sobre el mapa. Los agentes no están quietos: con la
 * "vida" (`useOfficeLife`) se levantan y CAMINAN al café o a una reunión y luego
 * vuelven a su escritorio — igual que "un día en la oficina" de MD.
 *
 * Todo el mapa se dibuja con CSS (sin imágenes generadas): piso con baldosas,
 * paredes, muebles cenitales (escritorio + monitor que prende cuando trabaja).
 * Es consistente y crujiente en cualquier tamaño.
 *
 * FASE 0 (prototipo del look): la "vida" es simulada en el cliente; todavía no
 * hay motor de IA ni reflejo del backend real (eso son fases siguientes).
 */

import { useEffect, useRef, useState } from 'react';
import { Send, Pause, Play, Wrench, X, Coffee, Users, Monitor } from 'lucide-react';
import { MrGoAvatar } from './MrGoAvatar';
import { MR_GO_PETS, type MrGoColorKey, type MrGoEmotion, type MrGoPetKey } from './types';
import type { AgentLife, LifeState, Spot } from './useOfficeLife';

export interface RoomAgent {
  key: string;
  nombre: string;
  rol: string;
  color: MrGoColorKey;
  emotion: MrGoEmotion;
  pet?: MrGoPetKey;
  highlighted?: boolean;
  director?: boolean;
  tools?: string[];
  paused?: boolean;
}

export interface OfficeFloorProps {
  agents: RoomAgent[];
  life?: Record<string, AgentLife>;
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
  onOrderAgent?: (key: string) => void;
  onTogglePause?: (key: string) => void;
  className?: string;
}

// Proporción del mapa (ancho:alto). Un poco más alto que 16:9 para que entren
// las salas de arriba + las zonas de abajo.
const FLOOR_W = 1280;
const FLOOR_H = 860;

// ---------------------------------------------------------------------------
// Departamentos (salas/zonas). El CEO va en "Dirección".
// ---------------------------------------------------------------------------

interface Depto {
  id: string;
  nombre: string;
  accent: string;
}

const DEPTOS: Record<string, Depto> = {
  direccion: { id: 'direccion', nombre: 'Dirección', accent: '#A855F7' },
  ventas: { id: 'ventas', nombre: 'Ventas & Cobros', accent: '#FFD93D' },
  atencion: { id: 'atencion', nombre: 'Atención', accent: '#7EC8E3' },
  marketing: { id: 'marketing', nombre: 'Marketing', accent: '#FF8EC7' },
  equipo: { id: 'equipo', nombre: 'Equipo', accent: '#6BCB77' },
};

const ROLE_TO_DEPTO: Record<string, string> = {
  ventas: 'ventas',
  finanzas: 'ventas',
  cobros: 'ventas',
  pagos: 'ventas',
  soporte: 'atencion',
  inbox: 'atencion',
  reservas: 'atencion',
  turnos: 'atencion',
  crm: 'atencion',
  marketing: 'marketing',
  campanas: 'marketing',
  contenido: 'marketing',
};

const MAIN_DEPTO_ORDER = ['ventas', 'atencion', 'marketing', 'equipo'];

function deptoDe(a: { key: string; director?: boolean }): string {
  if (a.director) return 'direccion';
  return ROLE_TO_DEPTO[a.key] ?? 'equipo';
}

// Acento del monitor según el color/rubro del agente.
const MR_GO_ACCENT: Record<MrGoColorKey, string> = {
  LILA: '#A855F7',
  RED: '#EF4444',
  PINK: '#FF8EC7',
  LIGHT_BLUE: '#7EC8E3',
  WHITE: '#CBD5E1',
  ORANGE: '#FF8C42',
  BROWN: '#B07A4A',
  BEIGE: '#E6D5B8',
  TURQUOISE: '#40E0D0',
  GREEN: '#6BCB77',
  LIME: '#A8E063',
  BLACK: '#64748B',
  BLUE: '#4A90E2',
  YELLOW: '#FFD93D',
};

// ---------------------------------------------------------------------------
// Cálculo del plano: ubica salas, escritorios (por coordenadas %) y destinos.
// ---------------------------------------------------------------------------

interface ZoneRect {
  id: string;
  label: string;
  accent: string;
  x: number;
  y: number;
  w: number;
  h: number;
  enclosed: boolean; // true = sala con paredes (café, reunión, dirección)
}

export interface FloorLayout {
  zones: ZoneRect[];
  desks: Record<string, Spot>; // puesto "hogar" de cada agente (coordenada del mueble)
  coffeeSpot: Spot;
  meetingSpots: Spot[];
}

// Banda superior (salas): café (izq) · Dirección (centro) · Reunión (der).
const TOP = { y: 5, h: 27 };
// Área principal (zonas de departamento con escritorios).
const MAIN = { x0: 4, y0: 40, x1: 96, y1: 95 };

/** Calcula todo el plano a partir de los agentes presentes. */
export function computeFloor(agents: RoomAgent[]): FloorLayout {
  const zones: ZoneRect[] = [];
  const desks: Record<string, Spot> = {};

  // --- Banda superior ---
  // Café (nicho, izquierda)
  zones.push({ id: 'cafe', label: 'Café', accent: '#FBBF24', x: 4, y: TOP.y, w: 16, h: TOP.h, enclosed: true });
  const coffeeSpot: Spot = { x: 12, y: TOP.y + TOP.h - 7 };

  // Dirección (centro) — el CEO
  const ceo = agents.find((a) => a.director);
  zones.push({
    id: 'direccion',
    label: DEPTOS.direccion.nombre,
    accent: DEPTOS.direccion.accent,
    x: 38,
    y: TOP.y,
    w: 24,
    h: TOP.h,
    enclosed: true,
  });
  if (ceo) desks[ceo.key] = { x: 50, y: TOP.y + TOP.h - 9 };

  // Sala de reunión (derecha)
  zones.push({ id: 'reunion', label: 'Reunión', accent: '#A5B4FC', x: 78, y: TOP.y, w: 18, h: TOP.h, enclosed: true });
  const meetingSpots: Spot[] = [
    { x: 84, y: TOP.y + TOP.h - 9 },
    { x: 90, y: TOP.y + TOP.h - 9 },
  ];

  // --- Área principal: zonas de departamento, de izquierda a derecha ---
  const deptos = MAIN_DEPTO_ORDER.map((id) => ({
    id,
    miembros: agents.filter((a) => !a.director && deptoDe(a) === id),
  })).filter((d) => d.miembros.length > 0);

  // Cada depto necesita un ancho proporcional a sus "columnas" de escritorios.
  const colsOf = (n: number) => (n <= 1 ? 1 : n <= 4 ? 2 : 3);
  const weights = deptos.map((d) => colsOf(d.miembros.length));
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
  const gap = 2.5;
  const availW = MAIN.x1 - MAIN.x0 - gap * Math.max(0, deptos.length - 1);

  let cursorX = MAIN.x0;
  deptos.forEach((d, di) => {
    const cols = colsOf(d.miembros.length);
    const rows = Math.ceil(d.miembros.length / cols);
    const zoneW = (availW * weights[di]) / totalWeight;
    const zx = cursorX;
    const zy = MAIN.y0;
    const zw = zoneW;
    const zh = MAIN.y1 - MAIN.y0;

    zones.push({
      id: d.id,
      label: DEPTOS[d.id].nombre,
      accent: DEPTOS[d.id].accent,
      x: zx,
      y: zy,
      w: zw,
      h: zh,
      enclosed: false,
    });

    // Área interna para los escritorios (deja aire para el rótulo arriba).
    const padX = 2;
    const innerX0 = zx + padX;
    const innerW = zw - padX * 2;
    const innerY0 = zy + 9; // bajo el rótulo
    const innerH = zh - 12;

    d.miembros.forEach((m, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const dx = innerX0 + ((c + 0.5) * innerW) / cols;
      const dy = innerY0 + ((r + 0.5) * innerH) / rows;
      desks[m.key] = { x: dx, y: dy };
    });

    cursorX += zoneW + gap;
  });

  // Fallback: cualquier agente sin puesto cae al centro.
  for (const a of agents) {
    if (!desks[a.key]) desks[a.key] = { x: 50, y: 70 };
  }

  return { zones, desks, coffeeSpot, meetingSpots };
}

/** Wrapper para el hook de vida (usa las mismas coordenadas del plano). */
export function buildOfficeLayout(agents: { key: string; director?: boolean }[]): {
  deskSpots: Record<string, Spot>;
  coffeeSpot: Spot;
  meetingSpots: Spot[];
} {
  // computeFloor necesita RoomAgent; para el hook alcanza con key/director.
  const asRoom = agents.map((a) => ({
    key: a.key,
    nombre: a.key,
    rol: '',
    color: 'LILA' as MrGoColorKey,
    emotion: 'working' as MrGoEmotion,
    director: a.director,
  }));
  const f = computeFloor(asRoom);
  return { deskSpots: f.desks, coffeeSpot: f.coffeeSpot, meetingSpots: f.meetingSpots };
}

// ---------------------------------------------------------------------------
// Estado del puesto a partir de la vida.
// ---------------------------------------------------------------------------

interface EstadoPuesto {
  label: string;
  dotCls: string;
  textCls: string;
  emotion: MrGoEmotion;
  away: boolean;
  screenOn: boolean;
}

function estadoDePuesto(agent: RoomAgent, state: LifeState): EstadoPuesto {
  if (agent.paused) {
    return { label: 'En pausa', dotCls: 'bg-slate-500', textCls: 'text-slate-400', emotion: 'sleepy', away: false, screenOn: false };
  }
  switch (state) {
    case 'coffee':
      return { label: 'En el café', dotCls: 'bg-amber-400', textCls: 'text-amber-300', emotion: 'happy', away: true, screenOn: false };
    case 'meeting':
      return { label: 'En reunión', dotCls: 'bg-indigo-400', textCls: 'text-indigo-300', emotion: 'thinking', away: true, screenOn: false };
    case 'walking':
      return { label: 'Yendo…', dotCls: 'bg-sky-400', textCls: 'text-sky-300', emotion: 'happy', away: true, screenOn: false };
    case 'idle':
      return { label: 'Disponible', dotCls: 'bg-sky-400', textCls: 'text-sky-300', emotion: agent.emotion === 'working' ? 'happy' : agent.emotion, away: false, screenOn: false };
    case 'working':
    default:
      return { label: 'Trabajando', dotCls: 'bg-emerald-400', textCls: 'text-emerald-300', emotion: agent.emotion, away: false, screenOn: true };
  }
}

// ---------------------------------------------------------------------------
// Componente principal.
// ---------------------------------------------------------------------------

export function OfficeFloor({
  agents,
  life,
  selectedKey,
  onSelect,
  onOrderAgent,
  onTogglePause,
  className,
}: OfficeFloorProps) {
  const layout = computeFloor(agents);
  const selected = selectedKey ? agents.find((a) => a.key === selectedKey) ?? null : null;

  // Medimos el ancho del piso para dimensionar muebles/avatares en px.
  const floorRef = useRef<HTMLDivElement>(null);
  const [floorW, setFloorW] = useState(0);
  useEffect(() => {
    const el = floorRef.current;
    if (!el) return;
    const measure = () => setFloorW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Contadores para el encabezado (vibe "command center").
  const estados = agents.map((a) => estadoDePuesto(a, life?.[a.key]?.state ?? (a.paused ? 'idle' : 'working')));
  const trabajando = estados.filter((e, i) => !agents[i].paused && e.label === 'Trabajando').length;
  const fuera = estados.filter((e) => e.away).length;
  const enPausa = agents.filter((a) => a.paused).length;

  return (
    <div className={className}>
      {/* Mini-dashboard del piso */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 font-medium text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          {trabajando} trabajando
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 font-medium text-amber-300">
          <Coffee className="h-3 w-3" />
          {fuera} fuera del puesto
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-600 bg-slate-700/40 px-2.5 py-1 font-medium text-slate-300">
          <Pause className="h-3 w-3" />
          {enPausa} en pausa
        </span>
      </div>

      {/* EL PISO */}
      <div
        ref={floorRef}
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: `${FLOOR_W} / ${FLOOR_H}`,
          borderRadius: 16,
          overflow: 'hidden',
          backgroundColor: '#1a1526',
          backgroundImage:
            'linear-gradient(rgba(168,120,247,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(168,120,247,0.06) 1px, transparent 1px)',
          backgroundSize: '3.2% 4.8%',
          boxShadow: 'inset 0 0 120px rgba(80,40,120,0.35)',
          border: '1px solid rgba(120,90,160,0.3)',
        }}
      >
        {/* Salas / zonas */}
        {layout.zones.map((z) => (
          <ZoneView key={z.id} zone={z} />
        ))}

        {/* Muebles de café y reunión */}
        <CoffeeBar spot={layout.coffeeSpot} floorW={floorW} />
        <MeetingTable spots={layout.meetingSpots} floorW={floorW} />

        {/* Escritorios (muebles) */}
        {floorW > 0 &&
          agents.map((a) => {
            const home = layout.desks[a.key];
            if (!home) return null;
            const st = estadoDePuesto(a, life?.[a.key]?.state ?? (a.paused ? 'idle' : 'working'));
            return (
              <DeskFurniture
                key={`desk-${a.key}`}
                x={home.x}
                y={home.y}
                floorW={floorW}
                accent={MR_GO_ACCENT[a.color] ?? '#A855F7'}
                on={st.screenOn}
                big={Boolean(a.director)}
              />
            );
          })}

        {/* Agentes (avatares ubicados por coordenadas, caminan con la vida) */}
        {floorW > 0 &&
          agents.map((a) => {
            const home = layout.desks[a.key] ?? { x: 50, y: 70 };
            const l = life?.[a.key];
            const x = l?.x ?? home.x;
            const y = l?.y ?? home.y;
            const state = l?.state ?? (a.paused ? 'idle' : 'working');
            const facing = l?.facing ?? 'right';
            const st = estadoDePuesto(a, state);
            return (
              <AgentView
                key={a.key}
                agent={a}
                x={x}
                y={y}
                estado={st}
                walking={state === 'walking'}
                facing={facing}
                floorW={floorW}
                selected={selectedKey === a.key}
                onSelect={onSelect}
              />
            );
          })}
      </div>

      {selected && (
        <AgentPanel
          agent={selected}
          estado={estadoDePuesto(selected, life?.[selected.key]?.state ?? (selected.paused ? 'idle' : 'working'))}
          onClose={() => onSelect?.(selected.key)}
          onOrder={onOrderAgent ? () => onOrderAgent(selected.key) : undefined}
          onTogglePause={onTogglePause ? () => onTogglePause(selected.key) : undefined}
        />
      )}
    </div>
  );
}

/** Una sala/zona: rectángulo con piso tintado + rótulo tipo placa de puerta. */
function ZoneView({ zone }: { zone: ZoneRect }) {
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        left: `${zone.x}%`,
        top: `${zone.y}%`,
        width: `${zone.w}%`,
        height: `${zone.h}%`,
        borderRadius: zone.enclosed ? 8 : 12,
        border: zone.enclosed ? `2px solid ${zone.accent}66` : `1px dashed ${zone.accent}44`,
        background: zone.enclosed
          ? `linear-gradient(180deg, ${zone.accent}18 0%, rgba(10,8,18,0.25) 100%)`
          : `linear-gradient(180deg, ${zone.accent}10 0%, rgba(10,8,18,0.15) 100%)`,
        boxShadow: zone.enclosed ? `inset 0 0 24px ${zone.accent}22` : 'none',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 0,
          left: 8,
          transform: 'translateY(-50%)',
          padding: '1px 8px',
          borderRadius: 999,
          background: zone.accent,
          color: '#120a1c',
          fontSize: 'clamp(8px, 0.85vw, 11px)',
          fontWeight: 800,
          letterSpacing: '0.03em',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
          boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
        }}
      >
        {zone.label}
      </span>
    </div>
  );
}

/** Barra de café (mueble cenital en el nicho). */
function CoffeeBar({ spot, floorW }: { spot: Spot; floorW: number }) {
  const w = Math.max(28, floorW * 0.07);
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        left: `${spot.x}%`,
        top: `${spot.y}%`,
        transform: 'translate(-50%, -50%)',
        width: w,
        height: w * 0.5,
        borderRadius: 6,
        background: 'linear-gradient(180deg, #3b2f26 0%, #241c16 100%)',
        border: '1px solid rgba(0,0,0,0.4)',
        boxShadow: '0 4px 10px rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fbbf24',
      }}
    >
      <Coffee style={{ width: w * 0.3, height: w * 0.3 }} />
    </div>
  );
}

/** Mesa de reunión (mueble cenital). */
function MeetingTable({ spots, floorW }: { spots: Spot[]; floorW: number }) {
  if (spots.length === 0) return null;
  const cx = spots.reduce((a, s) => a + s.x, 0) / spots.length;
  const cy = spots.reduce((a, s) => a + s.y, 0) / spots.length;
  const w = Math.max(34, floorW * 0.1);
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        left: `${cx}%`,
        top: `${cy}%`,
        transform: 'translate(-50%, -50%)',
        width: w,
        height: w * 0.55,
        borderRadius: 999,
        background: 'linear-gradient(180deg, #4a4030 0%, #2e2820 100%)',
        border: '1px solid rgba(0,0,0,0.4)',
        boxShadow: '0 4px 10px rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#a5b4fc',
      }}
    >
      <Users style={{ width: w * 0.22, height: w * 0.22 }} />
    </div>
  );
}

/** Escritorio cenital (tablero + monitor que prende), dibujado en el mapa. */
function DeskFurniture({
  x,
  y,
  floorW,
  accent,
  on,
  big,
}: {
  x: number;
  y: number;
  floorW: number;
  accent: string;
  on: boolean;
  big: boolean;
}) {
  const w = Math.max(30, floorW * (big ? 0.1 : 0.082));
  const h = w * 0.5;
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        left: `${x}%`,
        top: `${y}%`,
        // El mueble se dibuja un poco por delante (abajo) del punto del agente.
        transform: `translate(-50%, ${h * 0.35}px)`,
        width: w,
        height: h,
        zIndex: Math.round(y * 10) - 1,
      }}
    >
      {/* Tablero */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '8px 8px 10px 10px',
          background: 'linear-gradient(180deg, #6b4a32 0%, #4a3220 100%)',
          boxShadow: '0 5px 12px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.08)',
          border: '1px solid rgba(0,0,0,0.3)',
        }}
      />
      {/* Monitor contra el borde del fondo */}
      <div
        style={{
          position: 'absolute',
          top: h * 0.14,
          left: '50%',
          transform: 'translateX(-50%)',
          width: w * 0.4,
          height: h * 0.42,
          borderRadius: 3,
          background: '#0c0a14',
          border: '2px solid #1f1a2e',
          boxShadow: on ? `0 0 10px ${accent}aa` : 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            width: '80%',
            height: '66%',
            borderRadius: 2,
            background: on ? `linear-gradient(135deg, ${accent} 0%, ${accent}55 100%)` : 'linear-gradient(135deg,#1a1726,#0e0c16)',
            opacity: on ? 1 : 0.6,
          }}
        />
      </div>
    </div>
  );
}

/** Un agente ubicado en el mapa: etiqueta + avatar (camina) + sombra + estado. */
function AgentView({
  agent,
  x,
  y,
  estado,
  walking,
  facing,
  floorW,
  selected,
  onSelect,
}: {
  agent: RoomAgent;
  x: number;
  y: number;
  estado: EstadoPuesto;
  walking: boolean;
  facing: 'left' | 'right';
  floorW: number;
  selected: boolean;
  onSelect?: (key: string) => void;
}) {
  const clickable = Boolean(onSelect);
  const active = selected || agent.highlighted;
  const avatarPx = Math.max(26, floorW * (agent.director ? 0.092 : 0.072));

  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? () => onSelect!(agent.key) : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect!(agent.key);
              }
            }
          : undefined
      }
      aria-label={`${agent.nombre} — ${agent.rol} · ${estado.label}`}
      style={{
        position: 'absolute',
        left: `${x}%`,
        top: `${y}%`,
        transform: 'translate(-50%, -88%)',
        transition: 'left 2.6s ease-in-out, top 2.6s ease-in-out',
        zIndex: Math.round(y * 10),
        width: avatarPx,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        cursor: clickable ? 'pointer' : 'default',
      }}
    >
      {/* Etiqueta flotante (siempre visible, chica) */}
      <div
        style={{
          padding: '1px 6px',
          borderRadius: 999,
          background: active ? 'rgba(168,120,247,0.96)' : 'rgba(12,10,22,0.82)',
          border: `1px solid ${active ? 'rgba(168,120,247,0.6)' : 'rgba(120,90,160,0.4)'}`,
          fontSize: Math.max(8, Math.round(avatarPx * 0.14)),
          fontWeight: 700,
          color: '#fff',
          whiteSpace: 'nowrap',
          marginBottom: 1,
          boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
          pointerEvents: 'none',
        }}
      >
        {agent.director ? '★ ' : ''}
        {agent.nombre}
      </div>

      {/* Burbuja de tarea cuando recibió una orden */}
      {agent.highlighted && !agent.paused && (
        <div
          style={{
            position: 'absolute',
            top: -6,
            right: -4,
            zIndex: 6,
            padding: '1px 6px',
            borderRadius: 999,
            background: 'rgba(168,120,247,0.98)',
            color: '#fff',
            fontSize: Math.max(7, Math.round(avatarPx * 0.12)),
            fontWeight: 800,
            boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
          }}
        >
          ● tarea
        </div>
      )}

      {/* Avatar (respira/flota; se espeja al caminar a la izquierda) */}
      <div
        style={{
          transform: facing === 'left' ? 'scaleX(-1)' : undefined,
          filter: active ? 'drop-shadow(0 0 9px rgba(168,120,247,0.85))' : undefined,
          opacity: agent.paused ? 0.6 : 1,
          lineHeight: 0,
        }}
      >
        <MrGoAvatar
          color={agent.color}
          emotion={estado.emotion}
          pet={Boolean(agent.pet)}
          petKey={agent.pet}
          alive={!agent.paused}
          size={avatarPx}
        />
      </div>

      {/* Sombra de contacto (late al caminar) */}
      <div
        aria-hidden
        style={{
          width: '56%',
          height: Math.max(4, Math.round(avatarPx * 0.1)),
          marginTop: -Math.round(avatarPx * 0.03),
          borderRadius: '50%',
          background: 'radial-gradient(ellipse, rgba(20,10,35,0.5) 0%, transparent 72%)',
          filter: 'blur(1px)',
          animation: walking ? 'mrgo-step 0.6s ease-in-out infinite' : undefined,
        }}
      />

      {/* Chip de estado (puntito) */}
      <span
        className={`mt-0.5 inline-flex items-center gap-1 rounded-full px-1.5 py-[1px] text-[9px] font-medium ${estado.textCls}`}
        style={{ background: 'rgba(8,6,16,0.72)', border: '1px solid rgba(100,80,140,0.3)', whiteSpace: 'nowrap', pointerEvents: 'none' }}
      >
        <span className={`h-1 w-1 rounded-full ${estado.dotCls}`} />
        {estado.label}
      </span>

      <style>{`@keyframes mrgo-step{0%,100%{transform:scaleX(1);opacity:.5}50%{transform:scaleX(.8);opacity:.32}}`}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel funcional del agente seleccionado.
// ---------------------------------------------------------------------------

function AgentPanel({
  agent,
  estado,
  onClose,
  onOrder,
  onTogglePause,
}: {
  agent: RoomAgent;
  estado: EstadoPuesto;
  onClose: () => void;
  onOrder?: () => void;
  onTogglePause?: () => void;
}) {
  const paused = Boolean(agent.paused);

  return (
    <div className="mt-3 rounded-xl border border-brand-400/40 bg-slate-900/60 p-4">
      <div className="flex items-start gap-3">
        <div className="shrink-0">
          <MrGoAvatar color={agent.color} emotion={estado.emotion} size={56} pet petKey={agent.pet} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="truncate text-sm font-semibold text-white">
              {agent.director ? '★ ' : ''}
              {agent.nombre}
            </h3>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar panel del agente"
              className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-xs text-slate-400">{agent.rol}</p>
          <span
            className={`mt-1 inline-flex items-center gap-1 rounded border border-slate-600 bg-slate-800/60 px-1.5 py-0.5 text-[10px] font-medium ${estado.textCls}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${estado.dotCls}`} />
            {estado.label}
          </span>

          {agent.pet && (
            <p className="mt-2 text-[11px] text-slate-500">
              Mascota: <span className="text-slate-300">{MR_GO_PETS[agent.pet].nombre}</span> · {MR_GO_PETS[agent.pet].rol}
            </p>
          )}

          {agent.tools && agent.tools.length > 0 && (
            <div className="mt-2">
              <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500">
                <Monitor className="h-3 w-3" /> Puede ejecutar
              </span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {agent.tools.map((t) => (
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

/** Helper: mascota sugerida por rol. */
export function petForRole(roleKey: string): MrGoPetKey | undefined {
  const map: Record<string, MrGoPetKey> = {
    ceo: 'jinx',
    inbox: 'rayito',
    soporte: 'rayito',
    reservas: 'relojito',
    turnos: 'relojito',
    cobros: 'billetin',
    finanzas: 'billetin',
    pagos: 'billetin',
    analitica: 'cerebrito',
    operaciones: 'cerebrito',
    crm: 'cerebrito',
    marketing: 'megafonito',
    campanas: 'megafonito',
    contenido: 'megafonito',
  };
  const pet = map[roleKey];
  return pet && pet in MR_GO_PETS ? pet : undefined;
}
