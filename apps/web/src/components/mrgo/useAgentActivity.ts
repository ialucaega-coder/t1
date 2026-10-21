'use client';

/**
 * useAgentActivity — máquina de estados "en vivo" de cada Mr Go de color.
 *
 * Réplica del plano de eventos de Munder Difflin (SPEC.md §3): allá los hooks
 * PreToolUse/PostToolUse/Stop mueven al avatar por los estados
 * idle→alert→thinking→working→success. Acá NO hay streaming: `runMrGo` devuelve
 * la traza completa de la corrida de una sola vez. Entonces reproducimos
 * (`play`) esos pasos REALES en el tiempo para que el dueño "vea trabajar" a su
 * agente: cada paso pasa por pensando→trabajando con el tool que ejecutó, y al
 * final queda en listo / espera-tu-OK / error según cómo terminó el loop.
 *
 * Es playback de datos reales (los `steps` que volvieron del backend), no una
 * animación inventada. Respeta prefers-reduced-motion: salta directo al estado
 * final sin la coreografía intermedia.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MrGoEmotion } from './types';
import type { AgentStep, StopReason, ActionResult } from '@/lib/api/mrgo';

/** Estado de actividad de un agente (espeja los estados de SPEC.md §3). */
export type AgentRunState =
  | 'idle' // en el puesto, sin tarea
  | 'alert' // acaba de recibir la orden
  | 'thinking' // preparando el próximo paso
  | 'working' // ejecutando un tool
  | 'success' // resolvió la orden
  | 'blocked' // dejó una acción esperando confirmación del dueño
  | 'error'; // un paso falló

export interface AgentActivity {
  state: AgentRunState;
  /** Clave del tool que está ejecutando/preparando ahora (si aplica). */
  currentTool?: string;
  /** Estado del resultado del paso actual (ejecutado/simulado/error…). */
  currentStatus?: ActionResult['status'];
  /** Paso actual (1-based mientras corre; 0 en idle). */
  stepIndex: number;
  /** Cantidad total de pasos de la corrida. */
  totalSteps: number;
  /** Detalle del error, para la "tira de crash" de la tarjeta. */
  lastError?: string;
  /** Emoción del avatar derivada del estado. */
  emotion: MrGoEmotion;
}

const IDLE: AgentActivity = { state: 'idle', stepIndex: 0, totalSteps: 0, emotion: 'working' };

/** Emoción del avatar Mr Go según el estado de actividad. */
function emotionForState(state: AgentRunState): MrGoEmotion {
  switch (state) {
    case 'alert':
      return 'happy';
    case 'thinking':
      return 'thinking';
    case 'working':
      return 'working';
    case 'success':
      return 'happy';
    case 'blocked':
      return 'thinking';
    case 'error':
      return 'angry';
    default:
      return 'working';
  }
}

interface PlayOpts {
  /** Por qué terminó el loop (define el estado final: blocked / success). */
  stoppedReason?: StopReason;
}

/** true si el usuario pidió menos movimiento (accesibilidad). */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// Tiempos de la coreografía (ms). Cortos: es un resumen vivo, no una espera.
const ENTER = 350; // de alert a arrancar el primer paso
const THINK = 650; // "pensando" antes de ejecutar un tool
const WORK = 950; // "trabajando" en el tool
const HOLD_SUCCESS = 1500; // cuánto se queda en "listo" antes de volver a idle

/**
 * Hook que mantiene la actividad de todos los agentes y expone `play` para
 * reproducir la traza de una corrida sobre un agente dado.
 */
export function useAgentActivity() {
  const [activity, setActivity] = useState<Record<string, AgentActivity>>({});
  // Timers por agente: una corrida nueva cancela el playback anterior del mismo.
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>[]>>({});

  const clearAgent = useCallback((key: string) => {
    (timers.current[key] ?? []).forEach(clearTimeout);
    timers.current[key] = [];
  }, []);

  // Al desmontar, limpiamos todos los timers pendientes.
  useEffect(() => {
    const store = timers.current;
    return () => {
      Object.values(store).forEach((list) => list.forEach(clearTimeout));
    };
  }, []);

  const set = useCallback((key: string, patch: Partial<AgentActivity>) => {
    setActivity((prev) => {
      const base = prev[key] ?? IDLE;
      const next = { ...base, ...patch };
      next.emotion = emotionForState(next.state);
      return { ...prev, [key]: next };
    });
  }, []);

  const play = useCallback(
    (key: string, steps: AgentStep[], opts: PlayOpts = {}) => {
      clearAgent(key);
      const total = steps.length;
      const firstError = steps.find((s) => s.result.status === 'error');
      const finalState: AgentRunState =
        opts.stoppedReason === 'needs_confirmation' ? 'blocked' : firstError ? 'error' : 'success';
      const finalError = firstError?.result.detail;

      const push = (fn: () => void, delay: number) => {
        const t = setTimeout(fn, delay);
        (timers.current[key] ??= []).push(t);
      };

      // Sin coreografía: salto directo al estado final.
      if (prefersReducedMotion() || total === 0) {
        set(key, {
          state: finalState,
          stepIndex: total,
          totalSteps: total,
          currentTool: undefined,
          currentStatus: undefined,
          lastError: finalError,
        });
        if (finalState === 'success') push(() => set(key, { ...IDLE }), HOLD_SUCCESS);
        return;
      }

      // Coreografía: alert → (pensando → trabajando) × pasos → estado final.
      set(key, {
        state: 'alert',
        stepIndex: 0,
        totalSteps: total,
        currentTool: undefined,
        currentStatus: undefined,
        lastError: undefined,
      });

      let clock = ENTER;
      steps.forEach((step, i) => {
        push(
          () =>
            set(key, {
              state: 'thinking',
              stepIndex: i,
              totalSteps: total,
              currentTool: step.tool,
              currentStatus: undefined,
            }),
          clock,
        );
        clock += THINK;
        push(
          () =>
            set(key, {
              state: 'working',
              stepIndex: i + 1,
              totalSteps: total,
              currentTool: step.tool,
              currentStatus: step.result.status,
              lastError: step.result.status === 'error' ? step.result.detail : undefined,
            }),
          clock,
        );
        clock += WORK;
      });

      push(
        () =>
          set(key, {
            state: finalState,
            stepIndex: total,
            totalSteps: total,
            currentTool: undefined,
            currentStatus: undefined,
            lastError: finalError,
          }),
        clock,
      );
      if (finalState === 'success') push(() => set(key, { ...IDLE }), clock + HOLD_SUCCESS);
    },
    [clearAgent, set],
  );

  return { activity, play };
}
