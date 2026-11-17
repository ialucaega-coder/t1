/**
 * Arma las filas CSV de lo que se ve en Análisis y Estadísticas, a partir de los
 * datos YA cargados en pantalla (no hace requests). Formato largo, 4 columnas:
 * Sección, Concepto, Valor, Detalle. Los valores numéricos van como número; el
 * escape contra inyección de fórmulas lo hace `csvCell` (lib/csv.ts).
 */
import type { CsvCell } from '@/lib/csv';
import { rangeLabel, type RangeSelection } from '@/lib/date-range';
import type {
  AnalyticsKpi,
  AnalyticsConversation,
  AnalyticsSatisfaction,
  AnalyticsImprovement,
  AnalyticsCost,
  AnalyticsTimeseriesPoint,
  AnalyticsFunnel,
  AnalyticsAttribution,
} from '@/types/analytics';
import type { StatsOverview, WeeklyData, TopService } from '@/types';

export type CsvRow = CsvCell[];

const HEADER: CsvRow = ['Sección', 'Concepto', 'Valor', 'Detalle'];

/** "+5.0%" / "-3%" → número (5, -3); null si no se puede leer. */
export function percentToNumber(text: string | null | undefined): number | null {
  if (!text) return null;
  const n = parseFloat(text.replace('%', '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function periodRow(sel: RangeSelection | undefined, range?: { from: string; to: string; days: number }): CsvRow {
  const detail = range ? `${range.from} a ${range.to} (${range.days} días)` : '';
  return ['Período', rangeLabel(sel), null, detail];
}

export type AnalyticsExportTab = 'insights' | 'mejoras' | 'estadisticas' | 'reportes' | 'costos' | 'campanas';

export interface AnalyticsExportData {
  tab: AnalyticsExportTab;
  range?: RangeSelection;
  kpi: AnalyticsKpi;
  conversations: AnalyticsConversation[];
  satisfaction: AnalyticsSatisfaction[];
  improvements: AnalyticsImprovement[];
  costs: AnalyticsCost[];
  metrics: { label: string; value: string }[];
  timeseries: AnalyticsTimeseriesPoint[];
  funnel: AnalyticsFunnel | null;
  attribution: AnalyticsAttribution | null;
}

const fmtChange = (n: number, unit = '%') => `variación vs período anterior: ${n >= 0 ? '+' : ''}${n}${unit}`;

/** Filas del CSV de Análisis: el resumen (KPIs) siempre + el contenido de la pestaña activa. */
export function buildAnalyticsRows(d: AnalyticsExportData): CsvRow[] {
  const rows: CsvRow[] = [HEADER, periodRow(d.range, d.kpi.range)];

  rows.push(
    ['Resumen', 'Conversaciones', d.kpi.totalConversations, fmtChange(d.kpi.conversationsChange)],
    ['Resumen', 'Satisfacción (de 5)', d.kpi.avgSatisfaction, fmtChange(d.kpi.satisfactionChange, '')],
    ['Resumen', 'Costo IA estimado (USD)', d.kpi.monthlyAiCost, fmtChange(d.kpi.aiCostChange)],
    ['Resumen', 'Conversión de reservas (%)', d.kpi.conversionRate, fmtChange(d.kpi.conversionChange)],
  );

  const conversationsByDay = () =>
    d.conversations.forEach((c) => rows.push(['Conversaciones por día', c.date ?? c.day, c.count, c.date ? c.day : '']));

  switch (d.tab) {
    case 'insights':
      conversationsByDay();
      d.satisfaction.forEach((s) => rows.push(['Satisfacción', `${s.stars} estrellas`, s.count, '']));
      break;
    case 'estadisticas':
      conversationsByDay();
      d.metrics.forEach((m) => rows.push(['Métricas clave', m.label, m.value, '']));
      break;
    case 'mejoras':
      d.improvements.forEach((i) => rows.push(['Mejoras sugeridas', i.title, i.severity, `${i.category}: ${i.description}`]));
      break;
    case 'reportes':
      d.timeseries.forEach((t) => rows.push(['Mensajes por día', t.date, t.messages, '']));
      d.timeseries.forEach((t) => rows.push(['Conversaciones nuevas por día', t.date, t.conversations, '']));
      if (d.funnel) {
        const funnel = d.funnel;
        rows.push(['Embudo CRM (foto actual)', 'Total de contactos', funnel.total, '']);
        funnel.stages.forEach((s) =>
          rows.push([
            'Embudo CRM (foto actual)',
            s.label,
            s.count,
            `${s.pctOfTotal}% del total${s.conversionFromPrev === null ? '' : ` · ${s.conversionFromPrev}% de conversión`}`,
          ]),
        );
      }
      if (d.attribution) {
        const a = d.attribution;
        rows.push(['Origen (Click-to-WhatsApp)', 'Conversaciones totales', a.total, '']);
        rows.push(['Origen (Click-to-WhatsApp)', 'Desde anuncios', a.attributed, '']);
        a.bySource.forEach((s) => rows.push(['Origen (Click-to-WhatsApp)', `Origen: ${s.source}`, s.count, '']));
        a.byAd.forEach((ad) =>
          rows.push(['Origen (Click-to-WhatsApp)', ad.headline || ad.sourceId || 'Anuncio sin título', ad.count, ad.sourceId]),
        );
      }
      break;
    case 'costos': {
      d.costs.forEach((c) => rows.push(['Costos IA (estimados)', c.model, c.cost, `${c.tokens} tokens`]));
      rows.push(['Costos IA (estimados)', 'Total (USD)', d.kpi.monthlyAiCost, '']);
      break;
    }
    case 'campanas':
      break;
  }
  return rows;
}

export interface StatsExportData {
  range?: RangeSelection;
  overview: StatsOverview | null;
  weeklyData: WeeklyData[];
  topServices: TopService[];
}

/** Filas del CSV de Estadísticas: tarjetas + serie por día + top de servicios. */
export function buildStatsRows(d: StatsExportData): CsvRow[] {
  const rows: CsvRow[] = [HEADER, periodRow(d.range, d.overview?.range)];

  const o = d.overview;
  if (o) {
    rows.push(
      ['Resumen', 'Clientes', o.totalClients, ''],
      ['Resumen', 'Reservas', o.monthBookings, `variación vs período anterior (%): ${percentToNumber(o.bookingChange) ?? ''}`],
      ['Resumen', 'Ingresos', o.revenue, `variación vs período anterior (%): ${percentToNumber(o.revenueChange) ?? ''}`],
      ['Resumen', 'Tasa de no-show (%)', percentToNumber(o.noShowRate), `variación (puntos): ${percentToNumber(o.noShowChange) ?? ''}`],
    );
  }
  d.weeklyData.forEach((w) => {
    rows.push(['Reservas por día', w.date, w.bookings, w.day]);
  });
  d.weeklyData.forEach((w) => {
    rows.push(['Ingresos por día', w.date, w.revenue, w.day]);
  });
  d.topServices.forEach((s) => rows.push(['Top servicios', s.name, s.bookingCount, '']));
  return rows;
}

/** Nombre de archivo: `<base>-<rango>-<fecha de hoy>.csv`, sin caracteres raros. */
export function exportFilename(base: string, rangeKeyValue: string, today: string): string {
  const safe = (t: string) => t.replace(/[^a-zA-Z0-9_-]+/g, '-');
  return `${safe(base)}-${safe(rangeKeyValue)}-${safe(today)}.csv`;
}
