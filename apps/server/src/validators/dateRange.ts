import { z } from 'zod';
import { arDateKey } from '../services/analytics/time';

/** Tope del rango pedido (días calendario): evita consultas gigantes y series de miles de filas. */
export const MAX_RANGE_DAYS = 366;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Días entre dos fechas `YYYY-MM-DD` (inclusive en ambos extremos). */
function inclusiveDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

/**
 * Query de rango de fechas para analytics/stats. Tres formas (todas opcionales; sin
 * nada se mantiene el comportamiento histórico del endpoint):
 *   - `?days=N`           preset: los últimos N días calendario (hoy incluido), 1..366.
 *   - `?from=YYYY-MM-DD`  rango personalizado (días en hora de Argentina).
 *   - `&to=YYYY-MM-DD`    fin del rango; si falta es hoy. Una fecha futura se recorta a hoy.
 * `days` no se puede combinar con from/to; `to` exige `from`; `from <= to`; y el rango no
 * puede superar MAX_RANGE_DAYS días.
 */
export const dateRangeQuerySchema = z
  .object({
    days: z.coerce.number().int().min(1).max(MAX_RANGE_DAYS).optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  })
  .superRefine((q, ctx) => {
    if (q.days !== undefined && (q.from !== undefined || q.to !== undefined)) {
      ctx.addIssue({ code: 'custom', path: ['days'], message: 'Usá days o from/to, no ambos' });
      return;
    }
    if (q.to !== undefined && q.from === undefined) {
      ctx.addIssue({ code: 'custom', path: ['from'], message: 'from es obligatorio cuando se envía to' });
      return;
    }
    if (q.from === undefined) return;

    const today = arDateKey(new Date());
    if (q.from > today) {
      ctx.addIssue({ code: 'custom', path: ['from'], message: 'from no puede ser una fecha futura' });
      return;
    }
    const to = q.to === undefined || q.to > today ? today : q.to;
    if (q.from > to) {
      ctx.addIssue({ code: 'custom', path: ['from'], message: 'from no puede ser posterior a to' });
      return;
    }
    if (inclusiveDays(q.from, to) > MAX_RANGE_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['from'],
        message: `El rango no puede superar ${MAX_RANGE_DAYS} días`,
      });
    }
  });

export type DateRangeQuery = z.infer<typeof dateRangeQuerySchema>;
