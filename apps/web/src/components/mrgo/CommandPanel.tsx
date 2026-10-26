'use client';

/**
 * CommandPanel — el panel derecho del command-center de la Oficina.
 *
 * Es la "consola" del agente seleccionado: arriba su detalle vivo (avatar + rol +
 * estado + motor + acción actual), al medio el log estilo terminal de la última
 * corrida (un renglón por paso, con badge de estado), y abajo la cola de
 * confirmación cuando Mr Go dejó una acción sensible esperando el OK del dueño.
 *
 * Autocontenido y presentacional: toda la data entra por props (lo integra
 * page.tsx). La estética sigue el contrato de diseño (dark command-center:
 * superficies #0f1322/#141a2b, hairlines, tinta fría, lila de marca, estados por
 * ícono+texto+color). CERO emojis: sólo lucide-react.
 */

import { Cpu, Wrench, Check, AlertTriangle, Loader2, Users } from 'lucide-react';
import { MrGoAvatar } from './MrGoAvatar';
import type { MrGoColorKey } from './types';
import type { AgentActivity } from './useAgentActivity';
import type { AgentStep, PendingAction, ActionResult } from '@/lib/api/mrgo';

export interface CommandPanelAgent {
  key: string;
  nombre: string;
  rol: string;
  color: MrGoColorKey;
  engine?: string;
  model?: string;
}

export interface CommandPanelProps {
  /** Agente seleccionado (null = estado vacío). */
  agent: CommandPanelAgent | null;
  /** Actividad en vivo del agente. */
  activity?: AgentActivity;
  /** Pasos de la última corrida (para el log). */
  steps?: AgentStep[];
  /** Acción esperando confirmación. */
  pending?: PendingAction | null;
  /** true mientras se ejecuta la confirmación. */
  confirming?: boolean;
  toolLabel: (toolKey: string) => string;
  onConfirm?: () => void;
  onDiscard?: () => void;
}

// ─── Paleta del command-center (tokens del contrato) ─────────────────────────
const C = {
  card: '#ffffff',
  card2: '#faf7f0',
  hair: 'rgba(124,92,58,.16)',
  hairStrong: 'rgba(124,92,58,.28)',
  ink: '#3a322a',
  ink2: '#6a5f4e',
  muted: '#a99d87',
  brand: '#7c3aed',
  green: '#1f9d6b',
  amber: '#d98a1f',
  sky: '#2a86c4',
  red: '#d4493b',
  slate: '#a99d87',
} as const;

const RADIUS_CARD = 12;
const RADIUS_CTRL = 10;

/** Chip de estado (ícono de color + texto) derivado de activity.state. */
function stateChip(state: AgentActivity['state'] | undefined): {
  label: string;
  color: string;
  pulse: boolean;
} {
  switch (state) {
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

/** Presentación del badge de estado de un paso del log. */
function stepStatusView(status: ActionResult['status']): {
  label: string;
  color: string;
  icon: 'check' | 'alert' | null;
} {
  switch (status) {
    case 'ejecutado':
      return { label: 'ejecutado', color: C.green, icon: 'check' };
    case 'simulado':
      return { label: 'simulado', color: C.sky, icon: null };
    case 'omitido':
      return { label: 'omitido', color: C.amber, icon: null };
    case 'no_soportado':
      return { label: 'no soportado', color: C.slate, icon: null };
    case 'error':
      return { label: 'error', color: C.red, icon: 'alert' };
    default:
      return { label: status, color: C.slate, icon: null };
  }
}

/** Línea "qué hace ahora" según el estado. */
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
      return 'Resolvió la orden';
    case 'blocked':
      return 'Dejó una acción esperando tu OK';
    case 'error':
      return 'Se cortó en un paso';
    default:
      return 'Sin tareas por ahora';
  }
}

export function CommandPanel({
  agent,
  activity,
  steps,
  pending,
  confirming,
  toolLabel,
  onConfirm,
  onDiscard,
}: CommandPanelProps) {
  // ── Estado vacío: ningún agente seleccionado ──────────────────────────────
  if (!agent) {
    return (
      <aside
        className="flex min-h-[180px] flex-col items-center justify-center gap-3 p-6 text-center"
        style={{
          background: C.card,
          border: `1px solid ${C.hair}`,
          borderRadius: RADIUS_CARD,
        }}
      >
        <span
          className="inline-flex h-12 w-12 items-center justify-center"
          style={{
            background: C.card2,
            border: `1px solid ${C.hair}`,
            borderRadius: RADIUS_CTRL,
            color: C.muted,
          }}
        >
          <Users className="h-5 w-5" />
        </span>
        <p className="text-sm font-medium" style={{ color: C.ink2 }}>
          Elegí un agente del piso o del equipo
        </p>
        <p className="max-w-[26ch] text-xs" style={{ color: C.muted }}>
          Acá vas a ver su detalle, el log de lo que hizo y las acciones que esperan tu OK.
        </p>
      </aside>
    );
  }

  const chip = stateChip(activity?.state);
  const emotion = activity?.emotion ?? 'working';
  const working = activity?.state === 'working';
  const motor =
    agent.engine ? `${agent.engine}${agent.model ? ` · ${agent.model}` : ''}` : 'Motor del negocio';
  const hasSteps = !!steps && steps.length > 0;

  return (
    <aside
      className="flex flex-col gap-4 p-4"
      style={{ background: C.card, border: `1px solid ${C.hair}`, borderRadius: RADIUS_CARD }}
    >
      {/* ── Detalle del agente ─────────────────────────────────────────────── */}
      <section
        className="flex flex-col gap-3 p-3"
        style={{ background: C.card2, border: `1px solid ${C.hair}`, borderRadius: RADIUS_CARD }}
      >
        <div className="flex items-start gap-3">
          <div className="shrink-0">
            <MrGoAvatar color={agent.color} emotion={emotion} size={56} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold" style={{ color: C.ink }}>
              {agent.nombre}
            </h2>
            <p className="truncate text-xs" style={{ color: C.muted }}>
              {agent.rol}
            </p>
            <span
              className="mt-1.5 inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-medium"
              style={{
                borderRadius: 999,
                border: `1px solid ${chip.color}3d`,
                background: `${chip.color}14`,
                color: chip.color,
              }}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${chip.pulse ? 'animate-pulse' : ''}`}
                style={{ background: chip.color }}
              />
              {chip.label}
            </span>
          </div>
        </div>

        {/* Motor / modelo */}
        <div className="flex items-center gap-2 text-xs" style={{ color: C.ink2 }}>
          <Cpu className="h-3.5 w-3.5 shrink-0" style={{ color: C.muted }} />
          <span className="truncate font-mono" title={motor}>
            {motor}
          </span>
        </div>

        {/* Acción actual */}
        <div className="flex items-center gap-2 text-xs">
          <Wrench
            className="h-3.5 w-3.5 shrink-0"
            style={{ color: working ? C.amber : C.muted }}
          />
          <span className="truncate" style={{ color: working ? C.amber : C.ink2 }}>
            {actionLine(activity, toolLabel)}
          </span>
        </div>
      </section>

      {/* ── Log de pasos (estilo terminal) ─────────────────────────────────── */}
      {hasSteps && (
        <section className="flex flex-col gap-2">
          <h3
            className="font-mono text-[11px] uppercase tracking-wide"
            style={{ color: C.muted }}
          >
            Log de la corrida
          </h3>
          <ol
            className="flex max-h-56 flex-col gap-1 overflow-y-auto p-2 font-mono text-xs"
            style={{
              background: C.card2,
              border: `1px solid ${C.hair}`,
              borderRadius: RADIUS_CTRL,
            }}
          >
            {steps!.map((step, i) => {
              const sv = stepStatusView(step.result.status);
              return (
                <li
                  key={i}
                  className="flex items-center gap-2 px-1.5 py-1"
                  style={{ borderBottom: i < steps!.length - 1 ? `1px solid ${C.hair}` : 'none' }}
                >
                  <span className="shrink-0 tabular-nums" style={{ color: C.muted }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="min-w-0 flex-1 truncate" style={{ color: C.ink }}>
                    {toolLabel(step.tool)}
                  </span>
                  <span
                    className="inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5 text-[10px]"
                    style={{
                      borderRadius: 999,
                      border: `1px solid ${sv.color}3d`,
                      background: `${sv.color}14`,
                      color: sv.color,
                    }}
                  >
                    {sv.icon === 'check' && <Check className="h-3 w-3" />}
                    {sv.icon === 'alert' && <AlertTriangle className="h-3 w-3" />}
                    {sv.label}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {/* ── Cola de confirmación ───────────────────────────────────────────── */}
      {pending && (
        <section
          className="flex flex-col gap-2.5 p-3"
          style={{
            background: `${C.amber}0f`,
            border: `1px solid ${C.amber}3d`,
            borderRadius: RADIUS_CARD,
          }}
        >
          <h3 className="flex items-center gap-2 font-mono text-xs font-semibold" style={{ color: C.amber }}>
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Mr Go te preguntó
          </h3>
          <p className="text-xs" style={{ color: C.ink2 }}>
            Quiere ejecutar{' '}
            <span className="font-mono font-medium" style={{ color: C.ink }}>
              {toolLabel(pending.tool)}
            </span>
            {pending.thought ? `: ${pending.thought}` : '.'}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onConfirm}
              disabled={confirming}
              className="inline-flex cursor-pointer items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors duration-200 disabled:cursor-wait disabled:opacity-80"
              style={{
                borderRadius: RADIUS_CTRL,
                border: `1px solid ${C.green}5c`,
                background: `${C.green}1f`,
                color: C.green,
              }}
            >
              {confirming ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              Confirmar y ejecutar
            </button>
            <button
              type="button"
              onClick={onDiscard}
              disabled={confirming}
              className="inline-flex cursor-pointer items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors duration-200 disabled:opacity-50"
              style={{
                borderRadius: RADIUS_CTRL,
                border: `1px solid ${C.hairStrong}`,
                background: 'transparent',
                color: C.ink2,
              }}
            >
              Descartar
            </button>
          </div>
        </section>
      )}
    </aside>
  );
}
