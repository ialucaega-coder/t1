/**
 * Textos de la "satisfacción" y de los costos de IA en Análisis. La satisfacción NO sale
 * de calificaciones de clientes (todavía no se piden): el server la estima según cómo
 * terminan las conversaciones. Por eso se rotula siempre como estimada.
 */
import type { RangeSelection } from '@/lib/date-range';

export const SATISFACTION_LABEL = 'Satisfacción estimada';
export const SATISFACTION_HELP =
  'Se estima según cómo terminan las conversaciones; todavía no se piden calificaciones a los clientes.';

/** Nombre de cada nivel de la distribución estimada (neutro: no son estrellas reales). */
export const satisfactionLevelLabel = (level: number): string => `Nivel ${level} de 5`;

/** Rótulos de costo: "mensual" solo cuando no hay un rango elegido (ventana de 30 días). */
export function costLabels(range: RangeSelection | undefined): { cost: string; budget: string } {
  const hasRange = !!range && range.kind !== 'default';
  return hasRange
    ? { cost: 'Costo IA del período', budget: 'Presupuesto de referencia' }
    : { cost: 'Costo IA mensual', budget: 'Presupuesto mensual' };
}
