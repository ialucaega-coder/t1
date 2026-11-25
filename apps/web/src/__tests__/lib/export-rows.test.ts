/** Filas CSV de Análisis y Estadísticas: salen de los datos cargados y quedan a salvo de fórmulas. */
import { describe, it, expect } from 'vitest';
import { buildAnalyticsRows, buildStatsRows, percentToNumber, exportFilename, type AnalyticsExportData } from '@/lib/export-rows';
import { toCsv } from '@/lib/csv';

const KPI = {
  totalConversations: 40, conversationsChange: -12.5, avgSatisfaction: 4.2, satisfactionChange: 0.3,
  monthlyAiCost: 1.5, aiCostChange: 0, conversionRate: 50, conversionChange: 2, monthlyBudget: 50,
  range: { from: '2026-10-01', to: '2026-10-07', days: 7, custom: true },
};

const base = (over: Partial<AnalyticsExportData>): AnalyticsExportData => ({
  tab: 'insights', range: { kind: 'preset', days: 7 }, kpi: KPI,
  conversations: [], satisfaction: [], improvements: [], costs: [], metrics: [], timeseries: [],
  funnel: null, attribution: null, ...over,
});

describe('lib/export-rows — percentToNumber', () => {
  it('lee porcentajes con signo del server', () => {
    expect(percentToNumber('+5.0%')).toBe(5);
    expect(percentToNumber('-3.2%')).toBe(-3.2);
    expect(percentToNumber('')).toBeNull();
    expect(percentToNumber('abc')).toBeNull();
  });
});

describe('lib/export-rows — Análisis', () => {
  it('incluye período y KPIs, con el rango que devolvió el server', () => {
    const rows = buildAnalyticsRows(base({}));
    expect(rows[0]).toEqual(['Sección', 'Concepto', 'Valor', 'Detalle']);
    expect(rows[1]).toEqual(['Período', 'Últimos 7 días', null, '2026-10-01 a 2026-10-07 (7 días)']);
    expect(rows).toContainEqual(['Resumen', 'Conversaciones', 40, 'variación vs período anterior: -12.5%']);
  });

  it('exporta solo lo de la pestaña activa (insights: conversaciones por día, no costos)', () => {
    const rows = buildAnalyticsRows(base({
      conversations: [{ day: 'lun', date: '2026-10-05', count: 3 }],
      costs: [{ model: 'Claude Sonnet', tokens: 1000, cost: 0.5 }],
    }));
    expect(rows).toContainEqual(['Conversaciones por día', '2026-10-05', 3, 'lun']);
    expect(rows.some((r) => r[0] === 'Costos IA (estimados)')).toBe(false);
  });

  it('la satisfacción sale rotulada como estimada (KPI y distribución), sin estrellas', () => {
    const rows = buildAnalyticsRows(base({
      satisfaction: [{ stars: 5, count: 7, color: '#fff' }],
    }));
    const kpiRow = rows.find((r) => r[0] === 'Resumen' && String(r[1]).startsWith('Satisfacción'))!;
    expect(kpiRow[1]).toBe('Satisfacción estimada (de 5)');
    expect(String(kpiRow[3])).toMatch(/^estimada;/);
    expect(rows).toContainEqual(['Satisfacción estimada', 'Nivel 5 de 5', 7, 'estimada']);
    expect(toCsv(rows)).not.toContain('★');
    expect(toCsv(rows)).not.toMatch(/estrellas/);
  });

  it('el costo IA del resumen dice "mensual" sin rango y "del período" con rango', () => {
    const sinRango = buildAnalyticsRows(base({ range: { kind: 'default' } }));
    const conRango = buildAnalyticsRows(base({ range: { kind: 'preset', days: 30 } }));
    expect(sinRango.some((r) => r[1] === 'Costo IA mensual (USD, estimado)')).toBe(true);
    expect(conRango.some((r) => r[1] === 'Costo IA del período (USD, estimado)')).toBe(true);
    expect(conRango.some((r) => /mensual/i.test(String(r[1])))).toBe(false);
  });

  it('pestaña costos: un renglón por modelo más el total', () => {
    const rows = buildAnalyticsRows(base({ tab: 'costos', costs: [{ model: 'Claude Sonnet', tokens: 1000, cost: 0.5 }] }));
    expect(rows).toContainEqual(['Costos IA (estimados)', 'Claude Sonnet', 0.5, '1000 tokens']);
    expect(rows).toContainEqual(['Costos IA (estimados)', 'Total (USD)', 1.5, '']);
  });

  it('un texto con fórmula (p. ej. el título de un anuncio) sale neutralizado en el CSV final', () => {
    const rows = buildAnalyticsRows(base({
      tab: 'reportes',
      attribution: { total: 1, attributed: 1, bySource: [], byAd: [{ sourceId: 'ad1', headline: '=HYPERLINK("http://malo")', count: 1 }] },
    }));
    const csv = toCsv(rows);
    expect(csv).toContain(`"'=HYPERLINK(""http://malo"")"`);
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
  });
});

describe('lib/export-rows — Estadísticas', () => {
  it('arma tarjetas, series por día y top de servicios desde lo cargado', () => {
    const rows = buildStatsRows({
      range: { kind: 'default' },
      overview: {
        todayBookings: 1, monthBookings: 10, bookingChange: '+5.0%', totalClients: 7, revenue: 2500,
        revenueChange: '-2.0%', activeServices: 2, totalProducts: 1, noShowRate: '4.0%', noShowChange: '-1.0%',
      },
      weeklyData: [{ date: '2026-10-05', day: 'lun', bookings: 2, revenue: 100 }],
      topServices: [{ id: 's1', name: 'Corte', bookingCount: 4 }],
    });
    expect(rows).toContainEqual(['Resumen', 'Reservas', 10, 'variación vs período anterior (%): 5']);
    expect(rows).toContainEqual(['Reservas por día', '2026-10-05', 2, 'lun']);
    expect(rows).toContainEqual(['Ingresos por día', '2026-10-05', 100, 'lun']);
    expect(rows).toContainEqual(['Top servicios', 'Corte', 4, '']);
  });

  it('sin overview igual exporta lo que haya (no rompe)', () => {
    const rows = buildStatsRows({ overview: null, weeklyData: [], topServices: [] });
    expect(rows).toHaveLength(2);
  });
});

describe('lib/export-rows — exportFilename', () => {
  it('arma un nombre seguro', () => {
    expect(exportFilename('analisis-insights', '2026-10-01_2026-10-31', '2026-11-01')).toBe('analisis-insights-2026-10-01_2026-10-31-2026-11-01.csv');
    expect(exportFilename('a/b', 'x y', 'z')).toBe('a-b-x-y-z.csv');
  });
});
