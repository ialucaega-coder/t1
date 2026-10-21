'use client';

/**
 * AgentCard — la "fila que te dice todo" de cada Mr Go de color.
 *
 * Réplica del AgentCard de Munder Difflin (DESIGN.md §7.4 + skin Classic): una
 * tarjeta por agente con estado, motor + modelo de IA, la acción que ejecuta
 * AHORA, un medidor de progreso de la corrida (puntitos por paso) y una tira de
 * crash cuando un paso falla — en vez de un terminal mudo. Acá el personaje es
 * el Mr Go del color del rol (el CEO es el lila); las mascotas son decoración
 * del piso, no van en la tarjeta.
 *
 * La actividad en vivo viene de `useAgentActivity` (playback de la traza real).
 * Estética alineada al contrato del command-center (superficies #0f1322/#141a2b,
 * hairlines, tinta fría, radios 12px, font-mono para datos; íconos lucide, CERO
 * emojis). Firma de props y comportamiento sin cambios: es sólo pulido visual.
 */

import { Send, Wrench, Cpu, AlertTriangle, Star } from 'lucide-react';
import { MrGoAvatar } from './MrGoAvatar';
import type { MrGoColorKey } from './types';
import type { AgentActivity } from './useAgentActivity';

export interface AgentCardProps {
  nombre: string;
  rol: string;
  color: MrGoColorKey;
  /** Familia de proveedor de IA del agente (ej: 'anthropic'); opcional. */
  engine?: string;
  /** Modelo de IA del agente (ej: 'claude-3-5-sonnet'); opcional. */
  model?: string;
  /** Actividad en vivo (estado, paso actual, tool, error). */
  activity?: AgentActivity;
  director?: boolean;
  paused?: boolean;
  selected?: boolean;
  /** Traduce la clave de un tool a su nombre legible. */
  toolLabel?: (toolKey: string) => string;
  onSelect?: () => void;
  onOrder?: () => void;
}

// ─── Paleta del command-center (tokens del contrato) ─────────────────────────
const C = {
  card: '#0f1322',
  card2: '#141a2b',
  hair: 'rgba(150,165,215,.12)',
  hairStrong: 'rgba(150,165,215,.22)',
  ink: '#eaeefb',
  ink2: '#a9b2cc',
  muted: '#6c7694',
  brand: '#a855f7',
  green: '#34d399',
  amber: '#f5b740',
  sky: '#7dd3fc',
  red: '#f87171',
  slate: '#6c7694',
} as const;

/** Etiqueta + color + pulso según el estado de actividad. */
function statusView(
  activity: AgentActivity | undefined,
  paused?: boolean,
): { label: string; color: string; pulse: boolean } {
  if (paused) return { label: 'En pausa', color: C.slate, pulse: false };
  switch (activity?.state) {
    case 'alert':
      return { label: 'Atendiendo', color: C.brand, pulse: true };
    case 'thinking':
      return { label: 'Pensando', color: C.sky, pulse: true };
    case 'working':
      return { label: 'Trabajando', color: C.green, pulse: true };
    case 'success':
      return { label: 'Listo', color: C.green, pulse: false };
    case 'blocked':
      return { label: 'Espera tu OK', color: C.amber, pulse: true };
    case 'error':
      return { label: 'Error', color: C.red, pulse: false };
    default:
      return { label: 'Disponible', color: C.sky, pulse: false };
  }
}

/** Línea "qué está haciendo ahora" según el estado. */
function actionLine(
  activity: AgentActivity | undefined,
  toolLabel: (k: string) => string,
): string {
  if (!activity) return 'Sin tareas por ahora';
  const tool = activity.currentTool ? toolLabel(activity.currentTool) : '';
  switch (activity.state) {
    case 'alert':
      return 'Recibió la orden…';
    case 'thinking':
      return tool ? `Preparando: ${tool}` : 'Pensando el próximo paso…';
    case 'working':
      return tool ? `Ejecutando: ${tool}` : 'Trabajando…';
    case 'success':
      return `Resolvió en ${activity.totalSteps} paso${activity.totalSteps === 1 ? '' : 's'}`;
    case 'blocked':
      return 'Dejó una acción esperando tu confirmación';
    case 'error':
      return 'Se cortó en un paso';
    default:
      return 'Sin tareas por ahora';
  }
}

export function AgentCard({
  nombre,
  rol,
  color,
  engine,
  model,
  activity,
  director,
  paused,
  selected,
  toolLabel = (k) => k,
  onSelect,
  onOrder,
}: AgentCardProps) {
  const st = statusView(activity, paused);
  const emotion = paused ? 'sleepy' : activity?.emotion ?? 'working';
  const total = activity?.totalSteps ?? 0;
  const done = activity?.stepIndex ?? 0;
  const running =
    activity?.state === 'thinking' || activity?.state === 'working' || activity?.state === 'alert';
  const motor = engine ? `${engine}${model ? ` · ${model}` : ''}` : 'Motor del negocio';

  return (
    <div
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onClick={onSelect}
      onKeyDown={
        onSelect
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect();
              }
            }
          : undefined
      }
      className={`group relative flex flex-col gap-2.5 p-3 text-left transition-[border-color,box-shadow] duration-200 ${
        onSelect ? 'cursor-pointer' : ''
      }`}
      style={{
        background: C.card,
        borderRadius: 12,
        border: `1px solid ${selected ? `${C.brand}b3` : C.hair}`,
        boxShadow: selected ? `0 0 0 1px ${C.brand}66` : 'none',
      }}
    >
      {/* Encabezado: avatar + nombre + estado */}
      <div className="flex items-start gap-2.5">
        <div className="shrink-0" style={{ opacity: paused ? 0.6 : 1 }}>
          <MrGoAvatar color={color} emotion={emotion} alive={!paused} size={40} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {director && <Star className="h-3 w-3 shrink-0" style={{ color: C.amber }} aria-hidden />}
            <span className="truncate text-sm font-semibold" style={{ color: C.ink }}>
              {nombre}
            </span>
          </div>
          <p className="truncate text-[11px]" style={{ color: C.muted }}>
            {rol}
          </p>
        </div>
        <span
          className="inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium"
          style={{
            borderRadius: 999,
            border: `1px solid ${st.color}3d`,
            background: `${st.color}14`,
            color: st.color,
          }}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${st.pulse ? 'animate-pulse' : ''}`}
            style={{ background: st.color }}
          />
          {st.label}
        </span>
      </div>

      {/* Motor + modelo de IA */}
      <div className="flex items-center gap-1.5 text-[10px]" style={{ color: C.muted }}>
        <Cpu className="h-3 w-3 shrink-0" />
        <span className="truncate font-mono" title={motor}>
          {motor}
        </span>
      </div>

      {/* Acción actual */}
      <div className="flex items-center gap-1.5 text-[11px]">
        {running && activity?.currentTool ? (
          <Wrench className="h-3 w-3 shrink-0" style={{ color: C.amber }} />
        ) : null}
        <span className="truncate" style={{ color: running ? C.amber : C.ink2 }}>
          {actionLine(activity, toolLabel)}
        </span>
      </div>

      {/* Medidor de progreso: un puntito por paso de la corrida */}
      {total > 0 && (
        <div className="flex items-center gap-1 font-mono" aria-label={`Paso ${done} de ${total}`}>
          {Array.from({ length: Math.min(total, 10) }).map((_, i) => (
            <span
              key={i}
              className="h-1.5 flex-1 rounded-full transition-colors duration-200"
              style={{ background: i < done ? C.brand : C.hairStrong }}
            />
          ))}
        </div>
      )}

      {/* Tira de crash cuando un paso falló */}
      {activity?.lastError && activity.state === 'error' && (
        <div
          className="flex items-start gap-1.5 px-2 py-1.5"
          style={{
            borderRadius: 10,
            border: `1px solid ${C.red}4d`,
            background: `${C.red}0d`,
          }}
        >
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" style={{ color: C.red }} />
          <span className="line-clamp-2 text-[10px]" style={{ color: C.red }}>
            {activity.lastError}
          </span>
        </div>
      )}

      {/* Acción rápida: darle una orden directa */}
      {onOrder && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOrder();
          }}
          className="mt-0.5 inline-flex cursor-pointer items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium opacity-0 transition-[opacity,border-color,background] duration-200 focus:opacity-100 group-hover:opacity-100"
          style={{
            borderRadius: 10,
            border: `1px solid ${C.hairStrong}`,
            background: C.card2,
            color: C.ink2,
          }}
        >
          <Send className="h-3 w-3" />
          Darle una orden
        </button>
      )}
    </div>
  );
}
