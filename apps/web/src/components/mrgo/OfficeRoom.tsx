'use client';

/**
 * OfficeRoom — el piso de operaciones de Mr Go como un PLANO CENITAL (top-down).
 *
 * Reemplaza el diorama isométrico (agentes parados sobre una foto) por un plano
 * de oficina con LÓGICA, al estilo de la "pixel office" de Munder Difflin: cada
 * agente está SENTADO EN SU PROPIO PUESTO DE TRABAJO (escritorio + monitor), los
 * puestos están agrupados por departamento (como salas separadas por paredes), y
 * cada puesto muestra el estado del agente (trabajando / disponible / en pausa /
 * en el café / en reunión) y su tarea cuando recibe una orden.
 *
 * Todo el plano se dibuja con CSS (piso con grilla, salas con borde y rótulo,
 * escritorios con monitor que "prende" cuando el agente trabaja). No depende de
 * ninguna imagen generada: así se ve consistente y prolijo en cualquier tamaño.
 *
 * La "vida" (`useOfficeLife`) ya no mueve a los agentes por la pantalla; ahora
 * alimenta el ESTADO de cada puesto (trabajando/café/reunión…), que es lo que
 * de verdad comunica la oficina de MD. Clic en un puesto abre su panel.
 */

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

export interface OfficeRoomProps {
  agents: RoomAgent[];
  /** Estado de "vida" por agente (de useOfficeLife). Alimenta el estado del puesto. */
  life?: Record<string, AgentLife>;
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
  onOrderAgent?: (key: string) => void;
  onTogglePause?: (key: string) => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Departamentos: agrupan los puestos en "salas" con lógica (como MD separa por
// paredes). Mapeamos la clave del rol a un departamento; lo desconocido cae en
// "Equipo". El CEO siempre va en "Dirección".
// ---------------------------------------------------------------------------

interface Depto {
  id: string;
  nombre: string;
  /** Acento de la sala (coincide con el tono del rubro). */
  accent: string;
}

const DEPTOS: Record<string, Depto> = {
  direccion: { id: 'direccion', nombre: 'Dirección', accent: '#A855F7' },
  ventas: { id: 'ventas', nombre: 'Ventas & Cobros', accent: '#FFD93D' },
  atencion: { id: 'atencion', nombre: 'Atención al cliente', accent: '#7EC8E3' },
  marketing: { id: 'marketing', nombre: 'Marketing', accent: '#FF8EC7' },
  equipo: { id: 'equipo', nombre: 'Equipo', accent: '#6BCB77' },
};

// A qué departamento pertenece cada rol conocido.
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

/** Departamento de un agente (CEO → dirección; desconocido → equipo). */
function deptoDe(a: RoomAgent): string {
  if (a.director) return 'direccion';
  return ROLE_TO_DEPTO[a.key] ?? 'equipo';
}

// Orden en que se muestran las salas.
const DEPTO_ORDER = ['direccion', 'ventas', 'atencion', 'marketing', 'equipo'];

// ---------------------------------------------------------------------------
// Estado del puesto a partir de la "vida".
// ---------------------------------------------------------------------------

interface EstadoPuesto {
  label: string;
  dotCls: string; // color del puntito del estado (Tailwind)
  textCls: string; // color del texto del estado
  emotion: MrGoEmotion; // emoción del avatar en ese estado
  away: boolean; // true = fuera del escritorio (café/reunión/caminando)
  awayIcon?: 'coffee' | 'meeting';
  screenOn: boolean; // el monitor "prende" cuando está produciendo
}

function estadoDePuesto(agent: RoomAgent, state: LifeState): EstadoPuesto {
  if (agent.paused) {
    return {
      label: 'En pausa',
      dotCls: 'bg-slate-500',
      textCls: 'text-slate-400',
      emotion: 'sleepy',
      away: false,
      screenOn: false,
    };
  }
  switch (state) {
    case 'coffee':
      return {
        label: 'En el café',
        dotCls: 'bg-amber-400',
        textCls: 'text-amber-300',
        emotion: 'happy',
        away: true,
        awayIcon: 'coffee',
        screenOn: false,
      };
    case 'meeting':
      return {
        label: 'En reunión',
        dotCls: 'bg-indigo-400',
        textCls: 'text-indigo-300',
        emotion: 'thinking',
        away: true,
        awayIcon: 'meeting',
        screenOn: false,
      };
    case 'walking':
      return {
        label: 'Yendo…',
        dotCls: 'bg-sky-400',
        textCls: 'text-sky-300',
        emotion: 'happy',
        away: true,
        screenOn: false,
      };
    case 'idle':
      return {
        label: 'Disponible',
        dotCls: 'bg-sky-400',
        textCls: 'text-sky-300',
        emotion: agent.emotion === 'working' ? 'happy' : agent.emotion,
        away: false,
        screenOn: false,
      };
    case 'working':
    default:
      return {
        label: 'Trabajando',
        dotCls: 'bg-emerald-400',
        textCls: 'text-emerald-300',
        emotion: agent.emotion,
        away: false,
        screenOn: true,
      };
  }
}

// ---------------------------------------------------------------------------
// Layout para el hook de vida (el hook necesita spots; ya no se usan para
// posicionar en pantalla, pero sí para decidir quién "sale" a café/reunión).
// ---------------------------------------------------------------------------

export const COFFEE_SPOT: Spot = { x: 50, y: 50 };
export const MEETING_SPOTS: Spot[] = [
  { x: 40, y: 40 },
  { x: 60, y: 40 },
];

export function buildOfficeLayout(agents: { key: string; director?: boolean }[]): {
  deskSpots: Record<string, Spot>;
  coffeeSpot: Spot;
  meetingSpots: Spot[];
} {
  const deskSpots: Record<string, Spot> = {};
  agents.forEach((a, i) => {
    // Spots nominales en grilla (no se renderizan, solo existen para el hook).
    deskSpots[a.key] = { x: 20 + (i % 5) * 15, y: 30 + Math.floor(i / 5) * 20 };
  });
  return { deskSpots, coffeeSpot: COFFEE_SPOT, meetingSpots: MEETING_SPOTS };
}

// ---------------------------------------------------------------------------
// Componente principal.
// ---------------------------------------------------------------------------

export function OfficeRoom({
  agents,
  life,
  selectedKey,
  onSelect,
  onOrderAgent,
  onTogglePause,
  className,
}: OfficeRoomProps) {
  const selected = selectedKey ? agents.find((a) => a.key === selectedKey) ?? null : null;

  // Estado de cada agente (para los contadores del encabezado).
  const estados = agents.map((a) => estadoDePuesto(a, life?.[a.key]?.state ?? (a.paused ? 'idle' : 'working')));
  const trabajando = estados.filter((e, i) => !agents[i].paused && e.label === 'Trabajando').length;
  const fuera = estados.filter((e) => e.away).length;
  const enPausa = agents.filter((a) => a.paused).length;

  // Agrupamos los agentes por departamento, respetando DEPTO_ORDER.
  const grupos = DEPTO_ORDER.map((id) => ({
    depto: DEPTOS[id],
    miembros: agents.filter((a) => deptoDe(a) === id),
  })).filter((g) => g.miembros.length > 0);

  return (
    <div className={className}>
      {/* Mini-dashboard del piso (vibe "command center" de MD) */}
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

      {/* El piso: grilla sutil tipo baldosas + salas por departamento. */}
      <div
        style={{
          position: 'relative',
          borderRadius: 16,
          padding: 16,
          backgroundColor: '#14101f',
          backgroundImage:
            'linear-gradient(rgba(168,120,247,0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(168,120,247,0.055) 1px, transparent 1px)',
          backgroundSize: '26px 26px',
          boxShadow: 'inset 0 0 90px rgba(80,40,120,0.25)',
          border: '1px solid rgba(100,80,140,0.25)',
        }}
      >
        <div className="flex flex-col gap-3">
          {grupos.map(({ depto, miembros }) => (
            <section
              key={depto.id}
              style={{
                position: 'relative',
                borderRadius: 14,
                border: `1px solid ${depto.accent}33`,
                background: `linear-gradient(180deg, ${depto.accent}0d 0%, rgba(10,8,18,0.35) 100%)`,
                padding: '26px 14px 14px',
              }}
            >
              {/* Rótulo de la sala (como la placa de una puerta) */}
              <span
                style={{
                  position: 'absolute',
                  top: -1,
                  left: 14,
                  transform: 'translateY(-50%)',
                  padding: '2px 10px',
                  borderRadius: 999,
                  background: depto.accent,
                  color: '#120a1c',
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                  whiteSpace: 'nowrap',
                }}
              >
                {depto.nombre} · {miembros.length}
              </span>

              <div className="flex flex-wrap justify-center gap-x-2 gap-y-4 sm:justify-start">
                {miembros.map((a) => (
                  <Workstation
                    key={a.key}
                    agent={a}
                    estado={estadoDePuesto(a, life?.[a.key]?.state ?? (a.paused ? 'idle' : 'working'))}
                    facing={life?.[a.key]?.facing ?? 'right'}
                    selected={selectedKey === a.key}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
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

// ---------------------------------------------------------------------------
// Un puesto de trabajo: avatar sentado detrás de un escritorio cenital con
// monitor. Muestra el nombre, el rol y el estado.
// ---------------------------------------------------------------------------

function Workstation({
  agent,
  estado,
  facing,
  selected,
  onSelect,
}: {
  agent: RoomAgent;
  estado: EstadoPuesto;
  facing: 'left' | 'right';
  selected: boolean;
  onSelect?: (key: string) => void;
}) {
  const clickable = Boolean(onSelect);
  const active = selected || agent.highlighted;
  const avatarPx = agent.director ? 92 : 76;
  const deskW = agent.director ? 128 : 108;

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
      className="group"
      style={{
        position: 'relative',
        width: deskW + 20,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        cursor: clickable ? 'pointer' : 'default',
        borderRadius: 12,
        padding: '4px 4px 6px',
        background: active ? 'rgba(168,120,247,0.12)' : 'transparent',
        outline: active ? '1px solid rgba(168,120,247,0.5)' : '1px solid transparent',
        transition: 'background 0.2s, outline-color 0.2s',
      }}
    >
      {/* Burbuja de tarea cuando recibió una orden recién */}
      {agent.highlighted && !agent.paused && (
        <div
          style={{
            position: 'absolute',
            top: -8,
            right: 2,
            zIndex: 5,
            padding: '2px 7px',
            borderRadius: 999,
            background: 'rgba(168,120,247,0.96)',
            color: '#fff',
            fontSize: 9,
            fontWeight: 800,
            boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
            animation: 'mrgo-pop 0.25s ease-out',
          }}
        >
          ● en tarea
        </div>
      )}

      {/* Avatar sentado (se solapa con el borde superior del escritorio) */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          marginBottom: -Math.round(avatarPx * 0.22),
          transform: estado.away ? 'translateY(-4px)' : undefined,
          opacity: agent.paused ? 0.6 : estado.away ? 0.9 : 1,
          transition: 'transform 0.4s, opacity 0.3s',
          filter: active ? 'drop-shadow(0 0 10px rgba(168,120,247,0.85))' : undefined,
        }}
      >
        <div style={{ transform: facing === 'left' ? 'scaleX(-1)' : undefined, lineHeight: 0 }}>
          <MrGoAvatar
            color={agent.color}
            emotion={estado.emotion}
            pet={Boolean(agent.pet)}
            petKey={agent.pet}
            alive={!agent.paused}
            size={avatarPx}
          />
        </div>
      </div>

      {/* Escritorio cenital con monitor */}
      <Desk
        width={deskW}
        accent={MR_GO_ACCENT[agent.color] ?? '#A855F7'}
        screenOn={estado.screenOn}
        awayIcon={estado.awayIcon}
      />

      {/* Placa con nombre + rol */}
      <div
        style={{
          marginTop: 6,
          maxWidth: deskW + 16,
          textAlign: 'center',
          lineHeight: 1.15,
        }}
      >
        <div
          className="truncate"
          style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}
          title={agent.nombre}
        >
          {agent.director ? '★ ' : ''}
          {agent.nombre}
        </div>
        <div className="truncate" style={{ fontSize: 10, color: '#94a3b8' }} title={agent.rol}>
          {agent.rol}
        </div>
      </div>

      {/* Chip de estado */}
      <span
        className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${estado.textCls}`}
        style={{ background: 'rgba(8,6,16,0.6)', border: '1px solid rgba(100,80,140,0.3)' }}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${estado.dotCls}`} />
        {estado.label}
      </span>

      <style>{`@keyframes mrgo-pop{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}`}</style>
    </div>
  );
}

/** Escritorio visto desde arriba: tablero de madera + monitor que prende. */
function Desk({
  width,
  accent,
  screenOn,
  awayIcon,
}: {
  width: number;
  accent: string;
  screenOn: boolean;
  awayIcon?: 'coffee' | 'meeting';
}) {
  const h = Math.round(width * 0.42);
  return (
    <div style={{ position: 'relative', width, height: h }}>
      {/* Tablero del escritorio (trapecio sutil por perspectiva cenital) */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '10px 10px 14px 14px',
          background: 'linear-gradient(180deg, #6b4a32 0%, #4e3522 100%)',
          boxShadow: '0 6px 14px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.08)',
          border: '1px solid rgba(0,0,0,0.3)',
        }}
      />
      {/* Monitor centrado contra el borde del fondo */}
      <div
        style={{
          position: 'absolute',
          top: Math.round(h * 0.16),
          left: '50%',
          transform: 'translateX(-50%)',
          width: Math.round(width * 0.4),
          height: Math.round(h * 0.42),
          borderRadius: 4,
          background: '#0c0a14',
          border: '2px solid #1f1a2e',
          boxShadow: screenOn ? `0 0 12px ${accent}aa` : 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {/* Pantalla */}
        <div
          style={{
            width: '82%',
            height: '70%',
            borderRadius: 2,
            background: screenOn
              ? `linear-gradient(135deg, ${accent} 0%, ${accent}55 100%)`
              : 'linear-gradient(135deg, #1a1726 0%, #0e0c16 100%)',
            opacity: screenOn ? 1 : 0.6,
          }}
        />
      </div>
      {/* Teclado al frente */}
      <div
        style={{
          position: 'absolute',
          bottom: Math.round(h * 0.14),
          left: '50%',
          transform: 'translateX(-50%)',
          width: Math.round(width * 0.46),
          height: Math.max(5, Math.round(h * 0.12)),
          borderRadius: 3,
          background: 'rgba(20,16,30,0.85)',
          border: '1px solid rgba(255,255,255,0.06)',
        }}
      />
      {/* Objeto "fuera del puesto": taza de café / gente en reunión */}
      {awayIcon && (
        <div
          style={{
            position: 'absolute',
            top: -6,
            right: 6,
            color: awayIcon === 'coffee' ? '#fbbf24' : '#a5b4fc',
            filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))',
          }}
        >
          {awayIcon === 'coffee' ? <Coffee className="h-3.5 w-3.5" /> : <Users className="h-3.5 w-3.5" />}
        </div>
      )}
    </div>
  );
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
              Mascota: <span className="text-slate-300">{MR_GO_PETS[agent.pet].nombre}</span> ·{' '}
              {MR_GO_PETS[agent.pet].rol}
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
