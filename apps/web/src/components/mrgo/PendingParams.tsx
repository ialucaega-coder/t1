'use client';

import type { CSSProperties } from 'react';
import { summarizePendingParams } from './pending-summary';

interface PendingParamsProps {
  params: Record<string, unknown> | undefined | null;
  /** Estilos opcionales para integrarlo en cada paleta (Oficina clara / CommandPanel). */
  className?: string;
  labelStyle?: CSSProperties;
  valueStyle?: CSSProperties;
}

/**
 * Qué está por aprobar el dueño: destinatario (teléfono enmascarado), texto del mensaje,
 * monto, campaña, etc. Solo texto saneado (ver pending-summary).
 */
export function PendingParams({ params, className = '', labelStyle, valueStyle }: PendingParamsProps) {
  const rows = summarizePendingParams(params);
  if (rows.length === 0) {
    return (
      <p className={`text-[11px] italic ${className}`} style={labelStyle}>
        El agente no indicó datos para esta acción.
      </p>
    );
  }
  return (
    <dl className={`grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[11px] ${className}`} aria-label="Datos de la acción a confirmar">
      {rows.map((r) => (
        <div key={r.label} className="contents">
          <dt style={labelStyle}>{r.label}</dt>
          <dd className="min-w-0 break-words font-medium" style={valueStyle}>
            {r.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
