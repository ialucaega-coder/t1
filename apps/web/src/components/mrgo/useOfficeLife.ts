'use client';

/**
 * useOfficeLife
 * -------------
 * Hook puramente de cliente que da "vida" ambiental a los agentes que están
 * parados sobre el piso isométrico de la oficina. La mayoría del tiempo cada
 * agente permanece en su escritorio trabajando y, cada tanto, uno que está
 * inactivo camina hacia el rincón del café o a un punto de reunión y luego
 * regresa a su escritorio.
 *
 * El componente consumidor renderiza cada agente en la posición (x, y) en
 * porcentaje que devuelve este hook y aplica su propia transición CSS para el
 * movimiento suave. Por eso este hook SOLO fija posiciones y estados OBJETIVO
 * (no hay animación cuadro por cuadro aquí).
 */

import { useEffect, useMemo, useRef, useState } from 'react';

// --- Tipos públicos (deben coincidir exactamente con lo que consume el otro archivo) ---

export type LifeState = 'working' | 'idle' | 'walking' | 'coffee' | 'meeting';

export interface Spot {
  x: number;
  y: number;
} // porcentajes 0..100 sobre la imagen de la sala

export interface OfficeLifeInput {
  keys: string[]; // claves de los agentes presentes actualmente (incluye al CEO)
  deskSpots: Record<string, Spot>; // escritorio "hogar" de cada agente (fallback {x:50,y:60} si falta)
  coffeeSpot: Spot; // el rincón del café
  meetingSpots: Spot[]; // 0..n sillas en la mesa de reunión
  paused?: Set<string>; // los agentes pausados se quedan en su escritorio, estado 'idle'
  enabled?: boolean; // cuando es false (p. ej. reduced motion), todos se quedan en el escritorio trabajando
}

export interface AgentLife {
  x: number; // x% objetivo actual (0..100)
  y: number; // y% objetivo actual (0..100)
  state: LifeState; // por defecto trabajando en el escritorio
  facing: 'left' | 'right'; // left si se mueve/mira a la izquierda, si no right
}

// --- Constantes de comportamiento (en ms salvo probabilidades) ---

const TICK_MS = 2500; // cada cuánto evaluamos si alguien sale a pasear
const WANDER_CHANCE = 0.12; // ~12% por tick por agente de empezar a vagar
const MAX_AWAY = 2; // cap: como mucho ~2 agentes fuera del escritorio a la vez
const TRAVEL_MS = 2600; // duración del viaje (ida o vuelta)
const DWELL_MIN = 5000; // tiempo mínimo que se queda en el destino
const DWELL_MAX = 9000; // tiempo máximo que se queda en el destino

const DEFAULT_DESK: Spot = { x: 50, y: 60 }; // fallback de escritorio

// --- Utilidades ---

/** Acota un número al rango [0,100] y evita NaN. */
function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

/** Devuelve un Spot saneado (x,y en [0,100], sin NaN). */
function safeSpot(s: Spot | undefined): Spot {
  if (!s) return { ...DEFAULT_DESK };
  return { x: clampPct(s.x), y: clampPct(s.y) };
}

/** Entero aleatorio en [min, max]. */
function randBetween(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min));
}

/** Tipo de destino elegido al empezar a vagar. */
type Destination =
  | { kind: 'coffee'; spot: Spot }
  | { kind: 'meeting'; spot: Spot }
  | { kind: 'idle'; spot: Spot };

/**
 * Hook principal. Ver documentación arriba.
 */
export function useOfficeLife(input: OfficeLifeInput): Record<string, AgentLife> {
  const { keys, deskSpots, coffeeSpot, meetingSpots, paused, enabled } = input;

  // Normalizamos "enabled": si falta, se trata como false (todos quietos trabajando).
  const isEnabled = enabled === true;

  // Estado reactivo con la vida de cada agente. El componente re-renderiza
  // cuando cambia este objeto.
  const [lives, setLives] = useState<Record<string, AgentLife>>({});

  // Ref con las posiciones de escritorio actuales (saneadas) para que los
  // timers no dependan de closures obsoletos.
  const deskRef = useRef<Record<string, Spot>>({});

  // Ref con los agentes pausados (para que los timers lean el valor vigente).
  const pausedRef = useRef<Set<string>>(new Set());

  // Ref con el conjunto de claves vigentes (para descartar timers de agentes
  // que ya no existen).
  const keysRef = useRef<Set<string>>(new Set());

  // Ref con los spots de destino vigentes (café / reuniones).
  const spotsRef = useRef<{ coffee: Spot; meetings: Spot[] }>({
    coffee: { ...DEFAULT_DESK },
    meetings: [],
  });

  // Ref con los timeouts por agente, para poder limpiarlos al reconciliar o
  // al desmontar. Cada agente puede tener como mucho un timeout pendiente a la vez.
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Ref que indica si el hook sigue montado (evita setState tras desmontar).
  const mountedRef = useRef(true);

  // Ref SIEMPRE vigente con la vida actual. Clave: el bucle de vida corre dentro
  // de un efecto cuyo closure captura `lives` en el momento de crearse (vacío en
  // el primer render con agentes). Sin este ref, `startWander` leería ese `lives`
  // obsoleto/vacío y nadie caminaría nunca. Lo sincronizamos en cada render.
  const livesRef = useRef<Record<string, AgentLife>>({});

  // Memo estable de la lista de claves para dependencias de efectos.
  const keysSignature = useMemo(() => keys.join('|'), [keys]);

  // ---- Reconciliación de refs de entrada en cada render ----
  // Mantenemos los refs sincronizados con las props sin recrear timers.
  const safeDesks = useMemo(() => {
    const out: Record<string, Spot> = {};
    for (const k of keys) {
      out[k] = safeSpot(deskSpots[k]);
    }
    return out;
    // Dependemos de keys y deskSpots; coffeeSpot/meetingSpots se tratan aparte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keysSignature, deskSpots]);

  deskRef.current = safeDesks;
  livesRef.current = lives;
  pausedRef.current = paused ?? new Set<string>();
  keysRef.current = new Set(keys);
  spotsRef.current = {
    coffee: safeSpot(coffeeSpot),
    meetings: (meetingSpots ?? []).map(safeSpot),
  };

  // ---- Sincroniza el estado `lives` con las claves presentes ----
  // Las claves nuevas empiezan en su escritorio trabajando; las removidas salen.
  useEffect(() => {
    setLives((prev) => {
      const next: Record<string, AgentLife> = {};
      let changed = false;

      for (const k of keys) {
        const desk = deskRef.current[k] ?? { ...DEFAULT_DESK };
        const isPaused = pausedRef.current.has(k);
        const existing = prev[k];

        if (!isEnabled) {
          // Deshabilitado: todos en el escritorio trabajando.
          const target: AgentLife = {
            x: desk.x,
            y: desk.y,
            state: 'working',
            facing: 'right',
          };
          next[k] = target;
          if (
            !existing ||
            existing.x !== target.x ||
            existing.y !== target.y ||
            existing.state !== target.state ||
            existing.facing !== target.facing
          ) {
            changed = true;
          }
          continue;
        }

        if (isPaused) {
          // Pausado: siempre en su escritorio, estado 'idle', nunca vaga.
          const target: AgentLife = {
            x: desk.x,
            y: desk.y,
            state: 'idle',
            facing: existing?.facing ?? 'right',
          };
          next[k] = target;
          if (
            !existing ||
            existing.x !== target.x ||
            existing.y !== target.y ||
            existing.state !== target.state
          ) {
            changed = true;
          }
          continue;
        }

        if (existing) {
          // Conservamos su vida actual (puede estar vagando).
          next[k] = existing;
        } else {
          // Clave nueva: arranca en su escritorio trabajando.
          next[k] = { x: desk.x, y: desk.y, state: 'working', facing: 'right' };
          changed = true;
        }
      }

      // Detectamos claves que desaparecieron para marcar cambio.
      for (const k of Object.keys(prev)) {
        if (!(k in next)) changed = true;
      }

      return changed ? next : prev;
    });

    // Limpiamos timers de agentes que ya no están presentes o que pasaron a
    // estar pausados / deshabilitados.
    for (const k of Object.keys(timersRef.current)) {
      const stillActive =
        isEnabled && keysRef.current.has(k) && !pausedRef.current.has(k);
      if (!stillActive) {
        clearTimeout(timersRef.current[k]);
        delete timersRef.current[k];
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keysSignature, isEnabled, paused]);

  // ---- Bucle de vida: un único setInterval ----
  useEffect(() => {
    mountedRef.current = true;

    // Si está deshabilitado no corremos ningún timer.
    if (!isEnabled) {
      return () => {
        mountedRef.current = false;
      };
    }

    /** Programa un timeout para un agente, reemplazando cualquiera previo. */
    const schedule = (key: string, delay: number, fn: () => void) => {
      const prev = timersRef.current[key];
      if (prev) clearTimeout(prev);
      timersRef.current[key] = setTimeout(() => {
        // El timeout se consumió; lo quitamos del registro.
        delete timersRef.current[key];
        // Verificamos que el agente siga vivo, habilitado y no pausado.
        if (!mountedRef.current) return;
        if (!keysRef.current.has(key)) return;
        if (pausedRef.current.has(key)) return;
        fn();
      }, delay);
    };

    /** Actualiza la vida de un agente de forma segura. */
    const patch = (key: string, updater: (cur: AgentLife) => AgentLife) => {
      if (!mountedRef.current) return;
      setLives((prev) => {
        const cur = prev[key];
        if (!cur) return prev;
        const updated = updater(cur);
        return { ...prev, [key]: updated };
      });
    };

    /** Fase 3: camina de regreso al escritorio. */
    const walkHome = (key: string) => {
      const desk = deskRef.current[key] ?? { ...DEFAULT_DESK };
      patch(key, (cur) => ({
        x: desk.x,
        y: desk.y,
        state: 'walking',
        facing: desk.x < cur.x ? 'left' : 'right',
      }));
      // Al terminar el viaje de vuelta, retoma el trabajo.
      schedule(key, TRAVEL_MS, () => {
        const d = deskRef.current[key] ?? { ...DEFAULT_DESK };
        patch(key, () => ({
          x: d.x,
          y: d.y,
          state: 'working',
          facing: 'right',
        }));
      });
    };

    /** Fase 2: ha llegado al destino, se queda un rato y luego vuelve. */
    const arriveAndDwell = (key: string, dest: Destination) => {
      if (dest.kind === 'idle') {
        // Para 'idle' solo se queda parado cerca del escritorio un rato.
        patch(key, (cur) => ({ ...cur, state: 'idle' }));
      } else {
        patch(key, (cur) => ({ ...cur, state: dest.kind }));
      }
      const dwell = randBetween(DWELL_MIN, DWELL_MAX);
      schedule(key, dwell, () => walkHome(key));
    };

    /** Fase 1: elige un destino y empieza a caminar hacia él. */
    const startWander = (key: string) => {
      // Leemos del ref vigente, NO del closure `lives` (que puede estar obsoleto).
      const cur = livesRef.current[key];
      if (!cur) return;

      const { coffee, meetings } = spotsRef.current;

      // Elegimos un destino: café, una silla de reunión (si hay) o quedarse
      // 'idle' parado cerca del escritorio.
      const options: Destination[] = [{ kind: 'coffee', spot: coffee }];
      if (meetings.length > 0) {
        const m = meetings[randBetween(0, meetings.length)];
        options.push({ kind: 'meeting', spot: safeSpot(m) });
      }
      // Opción ocasional de simplemente quedarse inactivo cerca del escritorio.
      const desk = deskRef.current[key] ?? { ...DEFAULT_DESK };
      options.push({ kind: 'idle', spot: desk });

      const dest = options[randBetween(0, options.length)];
      const destSpot = safeSpot(dest.spot);

      patch(key, (c) => ({
        x: destSpot.x,
        y: destSpot.y,
        state: 'walking',
        facing: destSpot.x < c.x ? 'left' : 'right',
      }));

      // Tras el viaje, llega y se queda.
      schedule(key, TRAVEL_MS, () =>
        arriveAndDwell(key, { ...dest, spot: destSpot } as Destination),
      );
    };

    // Intervalo principal: en cada tick evaluamos qué agentes en su escritorio
    // podrían salir a pasear.
    const interval = setInterval(() => {
      if (!mountedRef.current) return;

      setLives((prev) => {
        // Contamos cuántos ya están fuera del escritorio.
        let away = 0;
        for (const k of Object.keys(prev)) {
          const st = prev[k]?.state;
          if (st === 'walking' || st === 'coffee' || st === 'meeting') away++;
        }

        // Candidatos: presentes, no pausados, actualmente en el escritorio
        // (estado 'working' o 'idle').
        for (const k of keysRef.current) {
          if (away >= MAX_AWAY) break;
          if (pausedRef.current.has(k)) continue;
          const cur = prev[k];
          if (!cur) continue;
          if (cur.state !== 'working' && cur.state !== 'idle') continue;
          // No reprogramamos si ya tiene un timer pendiente.
          if (timersRef.current[k]) continue;

          if (Math.random() < WANDER_CHANCE) {
            away++;
            // Lanzamos el paseo fuera del updater (en el próximo microtask) para
            // no mutar estado dentro del setState; usamos un timeout 0.
            schedule(k, 0, () => startWander(k));
          }
        }

        // No modificamos el estado aquí; los paseos lo harán vía patch().
        return prev;
      });
    }, TICK_MS);

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
      // Limpiamos TODOS los timeouts pendientes.
      for (const k of Object.keys(timersRef.current)) {
        clearTimeout(timersRef.current[k]);
        delete timersRef.current[k];
      }
    };
    // Reiniciamos el bucle si cambia habilitación o el set de claves.
    // `lives` se lee dentro de closures que se re-crean con cada arranque del
    // efecto, pero startWander también lee de prev vía setLives, por lo que no
    // dependemos de `lives` para evitar reinicios constantes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEnabled, keysSignature]);

  // ---- Garantía: el objeto devuelto SIEMPRE incluye una entrada por clave ----
  const result = useMemo(() => {
    const out: Record<string, AgentLife> = {};
    for (const k of keys) {
      const desk = safeDesks[k] ?? { ...DEFAULT_DESK };
      const existing = lives[k];
      if (existing) {
        out[k] = {
          x: clampPct(existing.x),
          y: clampPct(existing.y),
          state: existing.state,
          facing: existing.facing,
        };
      } else {
        // Fallback: escritorio trabajando (cubre el primer render antes del efecto).
        out[k] = { x: desk.x, y: desk.y, state: 'working', facing: 'right' };
      }
    }
    return out;
  }, [keysSignature, lives, safeDesks]);

  return result;
}
