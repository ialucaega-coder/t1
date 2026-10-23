'use client';

/**
 * OfficeFloor — la oficina de Mr Go como un PLANO CENITAL (top-down) estilo
 * CENTRO DE OPERACIONES oscuro (command-center premium), espacioso y legible.
 *
 * El piso es un MAPA oscuro: zonas de departamento amplias (con aire), un par de
 * salas destacadas (Dirección con glow lila, Café y Reunión como estaciones) y
 * cada agente UBICADO POR COORDENADAS. Con la "vida" (`useOfficeLife`) los
 * agentes se levantan y CAMINAN al café o a una reunión y luego vuelven a su
 * puesto. Los personajes son los Mr Go clay reales (`MrGoAvatar`), más grandes
 * y bien separados; NUNCA se dibujan gotas/blobs propios.
 *
 * Todo el mapa se dibuja con CSS sobre una escena `#0a0d18` con grilla sutil.
 * La calidez/personalidad la dan los personajes clay, no el fondo.
 *
 * FASE 0 (prototipo del look): la "vida" es simulada en el cliente; todavía no
 * hay motor de IA ni reflejo del backend real (eso son fases siguientes).
 */

import { useEffect, useRef, useState } from 'react';
import {
  Send,
  Pause,
  Play,
  Wrench,
  X,
  Coffee,
  Users,
  Crown,
  Activity,
  Cpu,
  Wallet,
  MessageSquare,
  Calendar,
  Megaphone,
  Mail,
} from 'lucide-react';
import { MrGoAvatar } from './MrGoAvatar';
import { MR_GO_PETS, type MrGoColorKey, type MrGoEmotion, type MrGoPetKey } from './types';
import type { AgentLife, LifeState, Spot } from './useOfficeLife';
import type { AgentActivity } from './useAgentActivity';

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
  /** Muestra el panel de detalle inline bajo el piso. Default true. Se apaga
   *  cuando el detalle se delega a un CommandPanel externo (evita duplicarlo). */
  showDetailPanel?: boolean;
  /** Actividad en vivo por agente: hace que cada Mr Go CAMINE a la estación de
   *  la acción que está ejecutando (Caja/Buzón/Agenda/Megáfono). */
  activity?: Record<string, AgentActivity>;
  /** Señal de delegación: cuando cambia `nonce`, vuela un sobre del CEO al
   *  agente `to`. */
  delivery?: { to: string; nonce: number } | null;
  className?: string;
}

// Proporción del mapa (ancho:alto). Un poco más alto que 16:9 para que entren
// la banda de salas de arriba + las zonas de departamento abajo con AIRE.
const FLOOR_W = 1280;
const FLOOR_H = 900;

// ---------------------------------------------------------------------------
// Paleta de la escena (command-center oscuro). Hex directos (tema oscuro).
// ---------------------------------------------------------------------------

const SCENE = {
  floor: '#0a0d18',
  surface: '#0f1322',
  node: '#141a2b',
  hairline: 'rgba(150,165,215,0.12)',
  hairlineStrong: 'rgba(150,165,215,0.22)',
  grid: 'rgba(150,165,215,0.05)',
  ink: '#eaeefb',
  inkMuted: '#a9b2cc',
  inkDim: '#6c7694',
  brand: '#a855f7',
  glow: 'rgba(168,85,247,0.45)',
} as const;

// ---------------------------------------------------------------------------
// Departamentos (zonas). El CEO va en "Dirección".
// ---------------------------------------------------------------------------

interface Depto {
  id: string;
  nombre: string;
  accent: string;
}

const DEPTOS: Record<string, Depto> = {
  direccion: { id: 'direccion', nombre: 'Dirección', accent: '#a855f7' },
  ventas: { id: 'ventas', nombre: 'Ventas & Cobros', accent: '#f5b740' },
  atencion: { id: 'atencion', nombre: 'Atención', accent: '#7dd3fc' },
  marketing: { id: 'marketing', nombre: 'Marketing', accent: '#f472b6' },
  equipo: { id: 'equipo', nombre: 'Equipo', accent: '#6bcb77' },
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

// ---------------------------------------------------------------------------
// Estaciones de acción: adónde camina un Mr Go cuando ejecuta cierta tool.
// Viven en la banda superior (en los huecos entre Café/Dirección/Reunión).
// ---------------------------------------------------------------------------

const ACTION_STATIONS = {
  caja: { spot: { x: 24, y: 15 }, label: 'Caja', accent: '#f5b740', icon: Wallet },
  buzon: { spot: { x: 30.5, y: 15 }, label: 'Buzón', accent: '#34d399', icon: MessageSquare },
  agenda: { spot: { x: 69, y: 15 }, label: 'Agenda', accent: '#7dd3fc', icon: Calendar },
  megafono: { spot: { x: 75.5, y: 15 }, label: 'Megáfono', accent: '#f472b6', icon: Megaphone },
} as const;
type StationId = keyof typeof ACTION_STATIONS;

// Qué tool manda a qué estación. Las acciones internas (mover etapa, crear
// cliente, notificar) NO tienen estación: el agente trabaja en su puesto.
const TOOL_STATION: Record<string, StationId> = {
  generar_link_pago: 'caja',
  enviar_whatsapp: 'buzon',
  crear_reserva: 'agenda',
  lanzar_campana: 'megafono',
};

/** Estación a la que debe ir un agente según su actividad en vivo (o null). */
function stationForActivity(act: AgentActivity | undefined): StationId | null {
  if (!act) return null;
  // 'blocked' incluido a propósito: el agente se queda PARADO en su estación
  // mientras espera el OK del dueño (p. ej. en la Caja con el link de pago).
  if (act.state !== 'working' && act.state !== 'thinking' && act.state !== 'blocked') return null;
  if (!act.currentTool) return null;
  return TOOL_STATION[act.currentTool] ?? null;
}

/** true si el usuario pidió menos movimiento (para no animar el sobre). */
function reducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

const MAIN_DEPTO_ORDER = ['ventas', 'atencion', 'marketing', 'equipo'];

function deptoDe(a: { key: string; director?: boolean }): string {
  if (a.director) return 'direccion';
  return ROLE_TO_DEPTO[a.key] ?? 'equipo';
}

// Acento del puesto según el color/rubro del agente.
const MR_GO_ACCENT: Record<MrGoColorKey, string> = {
  LILA: '#a855f7',
  RED: '#ef4444',
  PINK: '#f472b6',
  LIGHT_BLUE: '#7dd3fc',
  WHITE: '#cbd5e1',
  ORANGE: '#ff8c42',
  BROWN: '#b07a4a',
  BEIGE: '#e6d5b8',
  TURQUOISE: '#40e0d0',
  GREEN: '#6bcb77',
  LIME: '#a8e063',
  BLACK: '#64748b',
  BLUE: '#4a90e2',
  YELLOW: '#f5b740',
};

// ---------------------------------------------------------------------------
// Cálculo del plano: ubica salas, puestos (por coordenadas %) y destinos.
// ---------------------------------------------------------------------------

interface ZoneRect {
  id: string;
  label: string;
  accent: string;
  x: number;
  y: number;
  w: number;
  h: number;
  enclosed: boolean; // true = sala destacada (café, reunión, dirección)
}

export interface FloorLayout {
  zones: ZoneRect[];
  desks: Record<string, Spot>; // puesto "hogar" de cada agente (coordenada del mueble)
  coffeeSpot: Spot;
  meetingSpots: Spot[];
}

// Banda superior (salas): Café (izq) · Dirección (centro) · Reunión (der).
// Más aire que antes: la banda ocupa de 4% a 30%.
const TOP = { y: 4, h: 26 };
// Área principal (zonas de departamento con puestos). Respira hasta el 96%.
const MAIN = { x0: 4, y0: 37, x1: 96, y1: 96 };

/** Calcula todo el plano a partir de los agentes presentes. */
export function computeFloor(agents: RoomAgent[]): FloorLayout {
  const zones: ZoneRect[] = [];
  const desks: Record<string, Spot> = {};

  // --- Banda superior ---
  // Café (estación, izquierda)
  zones.push({ id: 'cafe', label: 'Café', accent: '#f5b740', x: 4, y: TOP.y, w: 16, h: TOP.h, enclosed: true });
  const coffeeSpot: Spot = { x: 11, y: TOP.y + TOP.h - 8 };

  // Dirección (centro, amplia) — el CEO
  const ceo = agents.find((a) => a.director);
  zones.push({
    id: 'direccion',
    label: DEPTOS.direccion.nombre,
    accent: DEPTOS.direccion.accent,
    x: 35,
    y: TOP.y,
    w: 30,
    h: TOP.h,
    enclosed: true,
  });
  if (ceo) desks[ceo.key] = { x: 50, y: TOP.y + TOP.h - 9 };

  // Sala de reunión (derecha)
  zones.push({ id: 'reunion', label: 'Reunión', accent: '#7dd3fc', x: 80, y: TOP.y, w: 16, h: TOP.h, enclosed: true });
  const meetingSpots: Spot[] = [
    { x: 85, y: TOP.y + TOP.h - 9 },
    { x: 91, y: TOP.y + TOP.h - 9 },
  ];

  // --- Área principal: zonas de departamento, de izquierda a derecha ---
  const deptos = MAIN_DEPTO_ORDER.map((id) => ({
    id,
    miembros: agents.filter((a) => !a.director && deptoDe(a) === id),
  })).filter((d) => d.miembros.length > 0);

  // Cada depto necesita un ancho proporcional a sus "columnas" de puestos.
  const colsOf = (n: number) => (n <= 1 ? 1 : n <= 4 ? 2 : 3);
  const weights = deptos.map((d) => colsOf(d.miembros.length));
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
  const gap = 3; // más separación entre zonas → más aire
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

    // Área interna para los puestos (deja aire arriba para el rótulo chip).
    const padX = 3;
    const innerX0 = zx + padX;
    const innerW = zw - padX * 2;
    const innerY0 = zy + 12; // bajo el rótulo
    const innerH = zh - 16;

    d.miembros.forEach((m, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const dx = innerX0 + ((c + 0.5) * innerW) / cols;
      const dy = innerY0 + ((r + 0.5) * innerH) / rows;
      desks[m.key] = { x: dx, y: dy };
    });

    cursorX += zoneW + gap;
  });

  // Fallback: cualquier agente sin puesto cae al centro del área.
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
      return { label: 'En reunión', dotCls: 'bg-sky-400', textCls: 'text-sky-300', emotion: 'thinking', away: true, screenOn: false };
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
  showDetailPanel = true,
  activity,
  delivery,
  className,
}: OfficeFloorProps) {
  const layout = computeFloor(agents);
  const selected = selectedKey ? agents.find((a) => a.key === selectedKey) ?? null : null;
  const direccion = layout.zones.find((z) => z.id === 'direccion');

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

  // ── Sobre que vuela CEO → agente al delegar una orden ──────────────────────
  // Coordenadas origen (CEO) / destino (agente) del sobre. El efecto de vuelo lo
  // maneja <EnvelopeFx/> montado con key=nonce (robusto a React Strict Mode).
  const ceoKey = agents.find((a) => a.director)?.key;
  const envFrom = ceoKey ? layout.desks[ceoKey] : undefined;
  const envTo = delivery ? layout.desks[delivery.to] : undefined;
  const showEnvelope =
    !!delivery && !!envFrom && !!envTo && ceoKey !== delivery.to && !reducedMotion();

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
          <Activity className="h-3 w-3" />
          <span className="font-mono tabular-nums">{trabajando}</span> trabajando
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 font-medium text-amber-300">
          <Coffee className="h-3 w-3" />
          <span className="font-mono tabular-nums">{fuera}</span> fuera del puesto
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-600/70 bg-slate-700/40 px-2.5 py-1 font-medium text-slate-300">
          <Pause className="h-3 w-3" />
          <span className="font-mono tabular-nums">{enPausa}</span> en pausa
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
          backgroundColor: SCENE.floor,
          backgroundImage: `linear-gradient(${SCENE.grid} 1px, transparent 1px), linear-gradient(90deg, ${SCENE.grid} 1px, transparent 1px)`,
          backgroundSize: '4% 5.5%',
          boxShadow: 'inset 0 0 160px rgba(0,0,0,0.55)',
          border: `1px solid ${SCENE.hairline}`,
        }}
      >
        {/* Glow lila difuso detrás de Dirección */}
        {direccion && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              left: `${direccion.x + direccion.w / 2}%`,
              top: `${direccion.y + direccion.h / 2}%`,
              width: '46%',
              height: '58%',
              transform: 'translate(-50%, -50%)',
              background: `radial-gradient(ellipse at center, ${SCENE.glow} 0%, transparent 68%)`,
              filter: 'blur(26px)',
              pointerEvents: 'none',
              zIndex: 0,
            }}
          />
        )}

        {/* Salas / zonas */}
        {layout.zones.map((z) => (
          <ZoneView key={z.id} zone={z} />
        ))}

        {/* Estaciones de café y reunión (nodos limpios) */}
        <StationNode spot={layout.coffeeSpot} floorW={floorW} accent="#f5b740" label="Café" icon={Coffee} />
        <MeetingStation spots={layout.meetingSpots} floorW={floorW} accent="#7dd3fc" />

        {/* Estaciones de acción: adónde camina cada Mr Go a ejecutar su tool */}
        {floorW > 0 &&
          (Object.keys(ACTION_STATIONS) as StationId[]).map((id) => {
            const s = ACTION_STATIONS[id];
            return (
              <StationNode key={id} spot={s.spot} floorW={floorW} accent={s.accent} label={s.label} icon={s.icon} />
            );
          })}

        {/* Puestos (muebles) */}
        {floorW > 0 &&
          agents.map((a) => {
            const home = layout.desks[a.key];
            if (!home) return null;
            // Si el agente está en una estación de acción, su puesto queda vacío
            // (pantalla apagada).
            const away = !a.paused && stationForActivity(activity?.[a.key]) !== null;
            const st = estadoDePuesto(a, life?.[a.key]?.state ?? (a.paused ? 'idle' : 'working'));
            return (
              <DeskFurniture
                key={`desk-${a.key}`}
                x={home.x}
                y={home.y}
                floorW={floorW}
                accent={MR_GO_ACCENT[a.color] ?? SCENE.brand}
                on={st.screenOn && !away}
                big={Boolean(a.director)}
              />
            );
          })}

        {/* Agentes (avatares ubicados por coordenadas, caminan con la vida) */}
        {floorW > 0 &&
          agents.map((a) => {
            const home = layout.desks[a.key] ?? { x: 50, y: 70 };
            const l = life?.[a.key];
            const baseX = l?.x ?? home.x;
            const baseY = l?.y ?? home.y;
            // Override por actividad: si está ejecutando una tool con estación,
            // camina hasta ella (la transición CSS de left/top anima el viaje).
            const stId = a.paused ? null : stationForActivity(activity?.[a.key]);
            const station = stId ? ACTION_STATIONS[stId] : null;
            const x = station ? station.spot.x : baseX;
            const y = station ? station.spot.y : baseY;
            const lifeState = l?.state ?? (a.paused ? 'idle' : 'working');
            const state: LifeState = station ? 'walking' : lifeState;
            const facing = station
              ? station.spot.x < baseX
                ? 'left'
                : 'right'
              : l?.facing ?? 'right';
            const base = estadoDePuesto(a, state);
            const st = station ? { ...base, label: `En ${station.label}`, away: true } : base;
            return (
              <AgentView
                key={a.key}
                agent={a}
                x={x}
                y={y}
                estado={st}
                walking={state === 'walking'}
                fastMove={Boolean(station)}
                facing={facing}
                floorW={floorW}
                selected={selectedKey === a.key}
                onSelect={onSelect}
              />
            );
          })}

        {/* Sobre volando CEO → agente al delegar una orden */}
        {floorW > 0 && showEnvelope && delivery && envFrom && envTo && (
          <EnvelopeFx key={delivery.nonce} from={envFrom} to={envTo} floorW={floorW} />
        )}
      </div>

      {showDetailPanel && selected && (
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

/** Una sala/zona: superficie oscura, borde de acento arriba (2px) y chip mono. */
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
        borderRadius: 12,
        borderTop: `2px solid ${zone.accent}`,
        borderRight: `1px solid ${SCENE.hairline}`,
        borderBottom: `1px solid ${SCENE.hairline}`,
        borderLeft: `1px solid ${SCENE.hairline}`,
        background: zone.enclosed
          ? `linear-gradient(180deg, ${zone.accent}1f 0%, rgba(15,19,34,0.55) 55%)`
          : `linear-gradient(180deg, ${zone.accent}12 0%, rgba(15,19,34,0.35) 60%)`,
        boxShadow: zone.enclosed
          ? `inset 0 0 40px ${zone.accent}1a, 0 10px 30px rgba(0,0,0,0.35)`
          : 'inset 0 0 24px rgba(0,0,0,0.25)',
        zIndex: 1,
      }}
    >
      {/* Rótulo tipo chip mono (en la esquina superior izquierda) */}
      <span
        className="font-mono"
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          padding: '2px 8px',
          borderRadius: 8,
          background: 'rgba(8,10,20,0.72)',
          border: `1px solid ${zone.accent}55`,
          color: zone.accent,
          fontSize: 'clamp(8px, 0.82vw, 11px)',
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
          backdropFilter: 'blur(2px)',
        }}
      >
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: zone.accent, display: 'inline-block' }} />
        {zone.label}
      </span>
    </div>
  );
}

/** Estación limpia (café): cuadrado redondeado oscuro + ícono lucide + mono. */
function StationNode({
  spot,
  floorW,
  accent,
  label,
  icon: Icon,
}: {
  spot: Spot;
  floorW: number;
  accent: string;
  label: string;
  icon: typeof Coffee;
}) {
  const s = Math.max(30, floorW * 0.058);
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        left: `${spot.x}%`,
        top: `${spot.y}%`,
        transform: 'translate(-50%, 18%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        zIndex: 2,
      }}
    >
      <div
        style={{
          width: s,
          height: s,
          borderRadius: 12,
          background: SCENE.node,
          border: `1px solid ${SCENE.hairline}`,
          boxShadow: `inset 0 1px 0 rgba(255,255,255,0.03), 0 6px 14px rgba(0,0,0,0.4)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: accent,
        }}
      >
        <Icon style={{ width: s * 0.42, height: s * 0.42 }} strokeWidth={1.6} />
      </div>
      <span
        className="font-mono"
        style={{
          fontSize: Math.max(8, Math.round(s * 0.2)),
          color: SCENE.inkDim,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
    </div>
  );
}

/** Estación de reunión (mesa) centrada entre las sillas. */
function MeetingStation({ spots, floorW, accent }: { spots: Spot[]; floorW: number; accent: string }) {
  if (spots.length === 0) return null;
  const cx = spots.reduce((a, s) => a + s.x, 0) / spots.length;
  const cy = spots.reduce((a, s) => a + s.y, 0) / spots.length;
  const w = Math.max(40, floorW * 0.09);
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        left: `${cx}%`,
        top: `${cy}%`,
        transform: 'translate(-50%, 16%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        zIndex: 2,
      }}
    >
      <div
        style={{
          width: w,
          height: w * 0.56,
          borderRadius: 14,
          background: SCENE.node,
          border: `1px solid ${SCENE.hairline}`,
          boxShadow: `inset 0 1px 0 rgba(255,255,255,0.03), 0 6px 14px rgba(0,0,0,0.4)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: accent,
        }}
      >
        <Users style={{ width: w * 0.26, height: w * 0.26 }} strokeWidth={1.6} />
      </div>
      <span
        className="font-mono"
        style={{
          fontSize: Math.max(8, Math.round(w * 0.13)),
          color: SCENE.inkDim,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        }}
      >
        Reunión
      </span>
    </div>
  );
}

/** Puesto cenital premium (tablero oscuro + pantalla que prende al trabajar). */
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
  const w = Math.max(38, floorW * (big ? 0.12 : 0.1));
  const h = w * 0.5;
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        left: `${x}%`,
        top: `${y}%`,
        // El mueble se dibuja un poco por delante (abajo) del punto del agente.
        transform: `translate(-50%, ${h * 0.42}px)`,
        width: w,
        height: h,
        zIndex: Math.round(y * 10) - 1,
      }}
    >
      {/* Tablero (superficie oscura tipo estación de trabajo) */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 12,
          background: `linear-gradient(180deg, ${SCENE.node} 0%, ${SCENE.surface} 100%)`,
          border: `1px solid ${SCENE.hairline}`,
          boxShadow: on
            ? `inset 0 1px 0 rgba(255,255,255,0.04), 0 6px 16px rgba(0,0,0,0.45), 0 0 18px ${accent}33`
            : 'inset 0 1px 0 rgba(255,255,255,0.03), 0 6px 16px rgba(0,0,0,0.45)',
        }}
      />
      {/* Pantalla contra el borde del fondo */}
      <div
        style={{
          position: 'absolute',
          top: h * 0.16,
          left: '50%',
          transform: 'translateX(-50%)',
          width: w * 0.42,
          height: h * 0.4,
          borderRadius: 4,
          background: '#070912',
          border: `1px solid ${SCENE.hairlineStrong}`,
          boxShadow: on ? `0 0 12px ${accent}aa` : 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            width: '80%',
            height: '64%',
            borderRadius: 2,
            background: on
              ? `linear-gradient(135deg, ${accent} 0%, ${accent}55 100%)`
              : 'linear-gradient(135deg,#12172a,#0a0d18)',
            opacity: on ? 1 : 0.5,
          }}
        />
      </div>
    </div>
  );
}

/** Un agente ubicado en el mapa: etiqueta + avatar (camina) + sombra + estado. */
/** Sobre que vuela de un punto a otro (CEO → agente). Se monta con key=nonce,
 *  anima una vez (from → to) y se retira. Robusto a React Strict Mode. */
function EnvelopeFx({ from, to, floorW }: { from: Spot; to: Spot; floorW: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [gone, setGone] = useState(false);
  // El vuelo se dispara con la Web Animations API, NO con una transición CSS: una
  // transición no arranca al montar (el nodo recién insertado no tiene valor previo
  // desde el cual interpolar, así que "salta" al destino). `el.animate` interpola
  // desde el primer keyframe sin depender del primer pintado — robusto en el montaje
  // y ante el doble-invoke de React Strict Mode.
  useEffect(() => {
    const el = ref.current;
    const anim = el?.animate?.(
      [
        { left: `${from.x}%`, top: `${from.y}%` },
        { left: `${to.x}%`, top: `${to.y}%` },
      ],
      { duration: 1000, easing: 'ease-in-out', fill: 'forwards' },
    );
    const t = setTimeout(() => setGone(true), 1150);
    return () => {
      anim?.cancel();
      clearTimeout(t);
    };
  }, [from.x, from.y, to.x, to.y]);
  if (gone) return null;
  const sz = Math.max(22, floorW * 0.03);
  return (
    <div
      ref={ref}
      aria-hidden
      style={{
        position: 'absolute',
        left: `${from.x}%`,
        top: `${from.y}%`,
        transform: 'translate(-50%, -50%)',
        zIndex: 9999,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          width: sz,
          height: sz,
          borderRadius: 8,
          background: SCENE.brand,
          border: '1px solid #c79bff',
          boxShadow: `0 6px 16px ${SCENE.glow}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
        }}
      >
        <Mail style={{ width: sz * 0.56, height: sz * 0.56 }} strokeWidth={2} />
      </div>
    </div>
  );
}

function AgentView({
  agent,
  x,
  y,
  estado,
  walking,
  fastMove,
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
  /** Viaje rápido (ir a una estación de acción), transición más corta. */
  fastMove?: boolean;
  facing: 'left' | 'right';
  floorW: number;
  selected: boolean;
  onSelect?: (key: string) => void;
}) {
  const clickable = Boolean(onSelect);
  const active = selected || agent.highlighted;
  // Avatares MÁS GRANDES (~35% respecto al diseño anterior) y bien separados.
  const avatarPx = Math.max(38, floorW * (agent.director ? 0.125 : 0.097));
  const labelFs = Math.max(10, Math.round(avatarPx * 0.17));

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
      className="mrgo-agent"
      style={{
        position: 'absolute',
        left: `${x}%`,
        top: `${y}%`,
        transform: 'translate(-50%, -86%)',
        transition: fastMove
          ? 'left 1.15s ease-in-out, top 1.15s ease-in-out'
          : 'left 2.6s ease-in-out, top 2.6s ease-in-out',
        zIndex: Math.round(y * 10),
        width: avatarPx,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        cursor: clickable ? 'pointer' : 'default',
      }}
    >
      {/* UNA etiqueta limpia con el nombre (Crown lucide si es director) */}
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 8px',
          borderRadius: 999,
          background: active ? 'rgba(168,85,247,0.95)' : 'rgba(10,13,24,0.85)',
          border: `1px solid ${active ? 'rgba(199,155,255,0.7)' : SCENE.hairline}`,
          fontSize: labelFs,
          fontWeight: 600,
          color: active ? '#fff' : SCENE.ink,
          whiteSpace: 'nowrap',
          marginBottom: 3,
          boxShadow: '0 2px 8px rgba(0,0,0,0.45)',
          pointerEvents: 'none',
        }}
      >
        {agent.director && <Crown style={{ width: labelFs, height: labelFs }} strokeWidth={2} />}
        {agent.nombre}
      </div>

      {/* Avatar (respira/flota; se espeja al caminar a la izquierda) */}
      <div
        style={{
          transform: facing === 'left' ? 'scaleX(-1)' : undefined,
          filter: active ? 'drop-shadow(0 0 12px rgba(168,85,247,0.9))' : undefined,
          opacity: agent.paused ? 0.55 : 1,
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
          width: '58%',
          height: Math.max(5, Math.round(avatarPx * 0.1)),
          marginTop: -Math.round(avatarPx * 0.03),
          borderRadius: '50%',
          background: 'radial-gradient(ellipse, rgba(0,0,0,0.55) 0%, transparent 72%)',
          filter: 'blur(1.5px)',
          animation: walking ? 'mrgo-step 0.6s ease-in-out infinite' : undefined,
        }}
      />

      {/* Chip de estado chico (punto + texto) */}
      <span
        className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[10px] font-medium ${estado.textCls}`}
        style={{ background: 'rgba(8,10,20,0.78)', border: `1px solid ${SCENE.hairline}`, whiteSpace: 'nowrap', pointerEvents: 'none' }}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${estado.dotCls}`} />
        {estado.label}
      </span>

      <style>{`
        @keyframes mrgo-step{0%,100%{transform:scaleX(1);opacity:.55}50%{transform:scaleX(.8);opacity:.34}}
        .mrgo-agent{transition:left 2.6s ease-in-out, top 2.6s ease-in-out;}
        @media (prefers-reduced-motion: reduce){
          .mrgo-agent{transition:none !important;}
        }
      `}</style>
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
          <MrGoAvatar color={agent.color} emotion={estado.emotion} size={64} pet petKey={agent.pet} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 truncate text-sm font-semibold text-white">
              {agent.director && <Crown className="h-4 w-4 text-brand-400" />}
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
                <Cpu className="h-3 w-3" /> Puede ejecutar
              </span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {agent.tools.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/60 px-2 py-0.5 font-mono text-[10px] text-amber-300"
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
