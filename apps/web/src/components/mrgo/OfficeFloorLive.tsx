'use client';

import { memo, useMemo } from 'react';
import { OfficeFloor, type OfficeFloorProps, type RoomAgent } from './OfficeFloor';
import { useOfficeLife, type Spot } from './useOfficeLife';

export interface OfficeFloorLiveProps extends Omit<OfficeFloorProps, 'life' | 'agents'> {
  agents: RoomAgent[];
  /** Salida de `buildOfficeLayout`. Debe venir memoizada (cambia solo si cambian agentes/posiciones). */
  layout: { deskSpots: Record<string, Spot>; coffeeSpot: Spot; meetingSpots: Spot[] };
  /** Agentes pausados: se quedan en su escritorio. */
  paused: Set<string>;
  /** false (p. ej. en el editor del piso): nadie deambula. */
  lifeEnabled: boolean;
}

/**
 * Piso de la oficina + su "vida" ambiental. `useOfficeLife` cambia de estado cada
 * vez que un agente sale a pasear o vuelve; si el hook viviera en la página, cada
 * paseo re-renderizaría toda la pantalla (Command Center, Studio, Memoria…).
 * Acá el estado queda encerrado: solo se re-renderiza este subárbol.
 */
function OfficeFloorLiveImpl({ agents, layout, paused, lifeEnabled, ...floorProps }: OfficeFloorLiveProps) {
  const keys = useMemo(() => agents.map((a) => a.key), [agents]);
  const life = useOfficeLife({
    keys,
    deskSpots: layout.deskSpots,
    coffeeSpot: layout.coffeeSpot,
    meetingSpots: layout.meetingSpots,
    paused,
    enabled: lifeEnabled,
  });
  return <OfficeFloor {...floorProps} agents={agents} life={life} />;
}

export const OfficeFloorLive = memo(OfficeFloorLiveImpl);
