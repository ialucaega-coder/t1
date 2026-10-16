'use client';

/**
 * OfficeRoom — la oficina de Mr Go como una escena isométrica clay.
 *
 * Reemplaza la maqueta de "tarjetas" por un diorama: un render isométrico de la
 * oficina (piso de madera, paredes lila, ventana, mesa de reunión, recepción,
 * café, plantas) con los Mr Go parados en el piso como figuritas, cada uno con
 * su sombra, su etiqueta flotante y su mascota. Inspirado en la oficina viva de
 * Munder Difflin (agentes que caminan por una sala top-down), adaptado al estilo
 * clay-3D de nuestros personajes.
 *
 * El fondo es `/mrgo/office/room.png` (generado con Figma AI). Los agentes se
 * ubican por coordenadas en % sobre la imagen (el punto es la BASE/pies). La
 * "vida" (caminata entre café/reunión/escritorio) la calcula `useOfficeLife` y
 * se pasa por la prop `life`; sin ella, cada agente queda parado en su spot.
 *
 * Funcional: clic en un agente abre su panel (estado, mascota, tools, darle una
 * orden, pausar/reactivar).
 */

import { useEffect, useRef, useState } from 'react';
import { Send, Pause, Play, Wrench, X } from 'lucide-react';
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

export interface OfficeRoomProps {
  agents: RoomAgent[];
  /** Posiciones/estados de "vida" por agente (de useOfficeLife). Opcional. */
  life?: Record<string, AgentLife>;
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
  onOrderAgent?: (key: string) => void;
  onTogglePause?: (key: string) => void;
  className?: string;
}

// Aspecto del render de la oficina (1376x768 ≈ 16:9 recortado).
const ROOM_W = 1376;
const ROOM_H = 768;

// Spots fijos sobre el piso (en %). El punto es la BASE (pies) del personaje.
// Evitan el mobiliario: café abajo-izq, mesa de reunión centro-izq, recepción a
// la derecha, rug arriba-izq. El CEO va en un lugar central y prominente.
const DESK_SPOTS: Spot[] = [
  { x: 50, y: 80 }, // 0 — centro-frente, prominente (CEO)
  { x: 26, y: 70 },
  { x: 40, y: 66 },
  { x: 61, y: 66 },
  { x: 75, y: 70 },
  { x: 17, y: 83 },
  { x: 33, y: 88 },
  { x: 45, y: 92 },
  { x: 58, y: 92 },
  { x: 68, y: 88 },
  { x: 81, y: 83 },
  { x: 31, y: 60 },
  { x: 70, y: 60 },
  { x: 86, y: 75 },
];

export const COFFEE_SPOT: Spot = { x: 17, y: 62 };
export const MEETING_SPOTS: Spot[] = [
  { x: 27, y: 66 },
  { x: 37, y: 74 },
];

/** Reparte spots de escritorio a los agentes (CEO primero → spot central). */
export function buildOfficeLayout(agents: { key: string; director?: boolean }[]): {
  deskSpots: Record<string, Spot>;
  coffeeSpot: Spot;
  meetingSpots: Spot[];
} {
  const ordered = [...agents].sort((a, b) => (a.director === b.director ? 0 : a.director ? -1 : 1));
  const deskSpots: Record<string, Spot> = {};
  ordered.forEach((a, i) => {
    deskSpots[a.key] = DESK_SPOTS[i % DESK_SPOTS.length];
  });
  return { deskSpots, coffeeSpot: COFFEE_SPOT, meetingSpots: MEETING_SPOTS };
}

/** Escala por profundidad: más al fondo (y chico) = más chico. */
function depthScale(y: number): number {
  const t = Math.max(0, Math.min(1, (y - 56) / (93 - 56)));
  return 0.8 + t * 0.36; // 0.8 (fondo) → 1.16 (frente)
}

export function OfficeRoom({
  agents,
  life,
  selectedKey,
  onSelect,
  onOrderAgent,
  onTogglePause,
  className,
}: OfficeRoomProps) {
  const layout = buildOfficeLayout(agents);
  const selected = selectedKey ? agents.find((a) => a.key === selectedKey) ?? null : null;

  // Medimos el ancho de la sala para dimensionar a los personajes en px.
  const roomRef = useRef<HTMLDivElement>(null);
  const [roomW, setRoomW] = useState(0);
  useEffect(() => {
    const el = roomRef.current;
    if (!el) return;
    const measure = () => setRoomW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className={className}>
      <div
        ref={roomRef}
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: `${ROOM_W} / ${ROOM_H}`,
          borderRadius: 16,
          overflow: 'hidden',
          backgroundColor: '#f0d9bd',
          backgroundImage: 'url(/mrgo/office/room.png)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          boxShadow: 'inset 0 0 60px rgba(60,30,80,0.18)',
        }}
      >
        {roomW > 0 &&
          agents.map((a) => {
            const l = life?.[a.key];
            const spot = layout.deskSpots[a.key] ?? { x: 50, y: 70 };
            const x = l?.x ?? spot.x;
            const y = l?.y ?? spot.y;
            const state: LifeState =
              l?.state ?? (a.paused ? 'idle' : a.emotion === 'working' ? 'working' : 'idle');
            const facing = l?.facing ?? 'right';
            const avatarPx = Math.max(30, Math.round(roomW * 0.118 * depthScale(y)));
            return (
              <RoomAgentView
                key={a.key}
                agent={a}
                x={x}
                y={y}
                state={state}
                facing={facing}
                avatarPx={avatarPx}
                selected={selectedKey === a.key}
                onSelect={onSelect}
              />
            );
          })}
      </div>

      {selected && (
        <AgentPanel
          agent={selected}
          onClose={() => onSelect?.(selected.key)}
          onOrder={onOrderAgent ? () => onOrderAgent(selected.key) : undefined}
          onTogglePause={onTogglePause ? () => onTogglePause(selected.key) : undefined}
        />
      )}
    </div>
  );
}

/** Un agente parado en el piso: etiqueta + avatar + sombra, posicionado por %. */
function RoomAgentView({
  agent,
  x,
  y,
  state,
  facing,
  avatarPx,
  selected,
  onSelect,
}: {
  agent: RoomAgent;
  x: number;
  y: number;
  state: LifeState;
  facing: 'left' | 'right';
  avatarPx: number;
  selected: boolean;
  onSelect?: (key: string) => void;
}) {
  const clickable = Boolean(onSelect);
  const walking = state === 'walking';
  const paused = agent.paused;

  const emotion: MrGoEmotion = paused
    ? 'sleepy'
    : state === 'coffee'
      ? 'happy'
      : state === 'meeting'
        ? 'thinking'
        : state === 'walking'
          ? 'happy'
          : agent.emotion;

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
      aria-label={`${agent.nombre} — ${agent.rol}${paused ? ' (pausado)' : ''}`}
      style={{
        position: 'absolute',
        left: `${x}%`,
        top: `${y}%`,
        transform: 'translate(-50%, -100%)',
        transition: 'left 2.6s ease-in-out, top 2.6s ease-in-out',
        zIndex: Math.round(y * 10),
        cursor: clickable ? 'pointer' : 'default',
        width: avatarPx,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        opacity: paused ? 0.6 : 1,
      }}
    >
      {/* Etiqueta flotante */}
      <div
        style={{
          padding: '1px 7px',
          borderRadius: 999,
          background: selected || agent.highlighted ? 'rgba(168,120,247,0.96)' : 'rgba(15,12,28,0.78)',
          border: '1px solid rgba(168,120,247,0.5)',
          fontSize: Math.max(9, Math.round(avatarPx * 0.13)),
          fontWeight: 700,
          color: '#fff',
          whiteSpace: 'nowrap',
          marginBottom: 1,
          boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
          pointerEvents: 'none',
        }}
      >
        {agent.director ? '★ ' : ''}
        {agent.nombre}
      </div>

      {/* Avatar (con su propia vida: respira/flota) */}
      <div
        style={{
          transform: facing === 'left' ? 'scaleX(-1)' : undefined,
          filter: selected || agent.highlighted ? 'drop-shadow(0 0 10px rgba(168,120,247,0.9))' : undefined,
          lineHeight: 0,
        }}
      >
        <MrGoAvatar color={agent.color} emotion={emotion} pet={Boolean(agent.pet)} petKey={agent.pet} alive={!paused} size={avatarPx} />
      </div>

      {/* Sombra de contacto */}
      <div
        aria-hidden
        style={{
          width: '58%',
          height: Math.max(5, Math.round(avatarPx * 0.1)),
          marginTop: -Math.round(avatarPx * 0.04),
          borderRadius: '50%',
          background: 'radial-gradient(ellipse, rgba(40,20,60,0.42) 0%, transparent 72%)',
          filter: 'blur(1px)',
          animation: walking ? 'mrgo-step 0.6s ease-in-out infinite' : undefined,
        }}
      />
      <style>{`@keyframes mrgo-step { 0%,100%{transform:scaleX(1);opacity:.42} 50%{transform:scaleX(.8);opacity:.3} }`}</style>
    </div>
  );
}

/** Panel funcional del agente seleccionado. */
function AgentPanel({
  agent,
  onClose,
  onOrder,
  onTogglePause,
}: {
  agent: RoomAgent;
  onClose: () => void;
  onOrder?: () => void;
  onTogglePause?: () => void;
}) {
  const paused = Boolean(agent.paused);
  const estado = paused ? 'En pausa' : agent.emotion === 'working' ? 'Trabajando' : 'Disponible';
  const estadoCls = paused
    ? 'bg-slate-500/10 text-slate-400 border-slate-500/20'
    : agent.emotion === 'working'
      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
      : 'bg-sky-500/10 text-sky-300 border-sky-500/20';

  return (
    <div className="mt-3 rounded-xl border border-brand-400/40 bg-slate-900/60 p-4">
      <div className="flex items-start gap-3">
        <div className="shrink-0">
          <MrGoAvatar color={agent.color} emotion={paused ? 'sleepy' : agent.emotion} size={56} pet petKey={agent.pet} />
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
          <span className={`mt-1 inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${estadoCls}`}>
            {estado}
          </span>

          {agent.pet && (
            <p className="mt-2 text-[11px] text-slate-500">
              Mascota: <span className="text-slate-300">{MR_GO_PETS[agent.pet].nombre}</span> · {MR_GO_PETS[agent.pet].rol}
            </p>
          )}

          {agent.tools && agent.tools.length > 0 && (
            <div className="mt-2">
              <span className="text-[10px] uppercase tracking-wide text-slate-500">Puede ejecutar</span>
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
