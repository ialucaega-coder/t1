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
 */

import { Send, Wrench, Cpu, AlertTriangle } from 'lucide-react';
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

/** Punto + etiqueta + color de texto según el estado de actividad. */
function statusView(activity: AgentActivity | undefined, paused?: boolean) {
  if (paused) return { label: 'En pausa', dot: 'bg-slate-500', text: 'text-slate-400' };
  switch (activity?.state) {
    case 'alert':
      return { label: 'Atendiendo', dot: 'bg-brand-400 animate-pulse', text: 'text-brand-300' };
    case 'thinking':
      return { label: 'Pensando', dot: 'bg-sky-400 animate-pulse', text: 'text-sky-300' };
    case 'working':
      return { label: 'Trabajando', dot: 'bg-emerald-400 animate-pulse', text: 'text-emerald-300' };
    case 'success':
      return { label: 'Listo', dot: 'bg-emerald-400', text: 'text-emerald-300' };
    case 'blocked':
      return { label: 'Espera tu OK', dot: 'bg-amber-400 animate-pulse', text: 'text-amber-300' };
    case 'error':
      return { label: 'Error', dot: 'bg-red-500', text: 'text-red-400' };
    default:
      return { label: 'Disponible', dot: 'bg-sky-400', text: 'text-sky-300' };
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
  const running = activity?.state === 'thinking' || activity?.state === 'working' || activity?.state === 'alert';
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
      className={`group relative flex flex-col gap-2 rounded-xl border bg-slate-900/50 p-3 text-left transition-colors ${
        selected
          ? 'border-brand-400/70 ring-1 ring-brand-400/40'
          : 'border-slate-700 hover:border-slate-600'
      } ${onSelect ? 'cursor-pointer' : ''}`}
    >
      {/* Encabezado: avatar + nombre + estado */}
      <div className="flex items-start gap-2.5">
        <div className="shrink-0" style={{ opacity: paused ? 0.6 : 1 }}>
          <MrGoAvatar color={color} emotion={emotion} alive={!paused} size={40} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {director && <span className="text-amber-400" aria-hidden>★</span>}
            <span className="truncate text-sm font-semibold text-white">{nombre}</span>
          </div>
          <p className="truncate text-[11px] text-slate-500">{rol}</p>
        </div>
        <span
          className={`shrink-0 inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800/70 px-1.5 py-0.5 text-[10px] font-medium ${st.text}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
          {st.label}
        </span>
      </div>

      {/* Motor + modelo de IA */}
      <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
        <Cpu className="h-3 w-3 shrink-0" />
        <span className="truncate" title={motor}>
          {motor}
        </span>
      </div>

      {/* Acción actual */}
      <div className="flex items-center gap-1.5 text-[11px]">
        {running && activity?.currentTool ? (
          <Wrench className="h-3 w-3 shrink-0 text-amber-400" />
        ) : null}
        <span className={`truncate ${running ? 'text-amber-200' : 'text-slate-400'}`}>
          {actionLine(activity, toolLabel)}
        </span>
      </div>

      {/* Medidor de progreso: un puntito por paso de la corrida */}
      {total > 0 && (
        <div className="flex items-center gap-1" aria-label={`Paso ${done} de ${total}`}>
          {Array.from({ length: Math.min(total, 10) }).map((_, i) => (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                i < done ? 'bg-brand-400' : 'bg-slate-700'
              }`}
            />
          ))}
        </div>
      )}

      {/* Tira de crash cuando un paso falló */}
      {activity?.lastError && activity.state === 'error' && (
        <div className="flex items-start gap-1.5 rounded-md border border-red-500/30 bg-red-500/5 px-2 py-1.5">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-red-400" />
          <span className="line-clamp-2 text-[10px] text-red-300">{activity.lastError}</span>
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
          className="mt-0.5 inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/60 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 opacity-0 transition-opacity hover:bg-slate-700 focus:opacity-100 group-hover:opacity-100"
        >
          <Send className="h-3 w-3" />
          Darle una orden
        </button>
      )}
    </div>
  );
}
