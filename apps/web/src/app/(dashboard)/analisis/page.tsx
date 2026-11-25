'use client';

import { useState, useEffect } from 'react';
import { Brain, TrendingUp, BarChart3, DollarSign, Megaphone, MessageCircle, Activity, Zap, AlertTriangle, Plus, Trash2, Send, Clock, CheckCircle2, LineChart, Filter, ChevronDown } from 'lucide-react';
import { useAnalytics } from '@/hooks/use-analytics';
import type { AnalyticsTimeseriesPoint, AnalyticsFunnel, AnalyticsAttribution } from '@/types/analytics';
import { useCampaigns } from '@/hooks/use-campaigns';
import { describeCampaignStatus } from '@/components/campaigns/schedule';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useToast } from '@/components/common/Toast';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import { EmptyState } from '@/components/common/EmptyState';
import { DateRangeBar } from '@/components/common/DateRangeBar';
import { DEFAULT_RANGE, rangeKey, todayLocalKey, type RangeSelection } from '@/lib/date-range';
import { downloadCsv } from '@/lib/csv';
import { SATISFACTION_LABEL, SATISFACTION_HELP, satisfactionLevelLabel, costLabels } from '@/lib/satisfaction';
import { buildAnalyticsRows, exportFilename } from '@/lib/export-rows';

// Clave de localStorage para recordar qué mejoras se aplicaron/ignoraron. Son
// sugerencias heurísticas con id posicional (no estable), así que las guardamos
// por título. Es una conveniencia por-dispositivo del admin, no estado del negocio.
const RESOLVED_IMPROVEMENTS_KEY = 'localb_analytics_improvements_resolved';

const TABS = [
  { id: 'insights', label: 'Insights', icon: Brain },
  { id: 'mejoras', label: 'Mejoras', icon: TrendingUp },
  { id: 'estadisticas', label: 'Estadísticas', icon: BarChart3 },
  { id: 'reportes', label: 'Reportes', icon: LineChart },
  { id: 'costos', label: 'Costos', icon: DollarSign },
  { id: 'campanas', label: 'Campañas', icon: Megaphone },
] as const;

type TabId = (typeof TABS)[number]['id'];

const severityColors = {
  alta: 'bg-red-500/10 text-red-400 border-red-500/20',
  media: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  baja: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
};

function BarChart({ data }: { data: { day: string; count: number }[] }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  const chartH = 160;
  // Con muchos días (rango elegido) las barras se afinan, y los números y etiquetas se espacian.
  const dense = data.length > 14;
  const barW = dense ? 10 : 36;
  const gap = dense ? 4 : 16;
  const labelEvery = dense ? Math.ceil(data.length / 12) : 1;
  const totalW = data.length * (barW + gap) - gap;

  return (
    <svg viewBox={`0 0 ${totalW + 20} ${chartH + 30}`} className={dense ? 'w-full' : 'w-full max-w-md'}>
      {data.map((d, i) => {
        const barH = (d.count / max) * chartH;
        const x = i * (barW + gap) + 10;
        const y = chartH - barH;
        return (
          <g key={`${d.day}-${i}`}>
            <rect x={x} y={y} width={barW} height={barH} rx={4} fill="#38BDF8" opacity={0.8} />
            {!dense && <text x={x + barW / 2} y={y - 6} textAnchor="middle" className="text-[10px]" fill="#94A3B8">{d.count}</text>}
            {i % labelEvery === 0 && (
              <text x={x + barW / 2} y={chartH + 16} textAnchor="middle" className="text-[10px]" fill="#64748B">{d.day}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function SatisfactionRing({ data, avgScore }: { data: { stars: number; count: number; color: string }[]; avgScore: number }) {
  const total = data.reduce((s, d) => s + d.count, 0);
  if (total === 0) return <p className="text-xs text-slate-500">Sin conversaciones en el período para estimar.</p>;
  const r = 60;
  const circumference = 2 * Math.PI * r;
  // Offset acumulado de cada segmento (sin reasignar variables durante el render).
  const offsets: number[] = [];
  let acumulado = 0;
  for (const d of data) {
    offsets.push(acumulado);
    acumulado += (d.count / total) * circumference;
  }

  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg viewBox="0 0 160 160" className="w-36 h-36">
        {data.map((d, i) => {
          const pct = d.count / total;
          const dashLen = pct * circumference;
          const offset = offsets[i];
          return (
            <circle key={d.stars} cx={80} cy={80} r={r} fill="none" stroke={d.color} strokeWidth={18}
              strokeDasharray={`${dashLen} ${circumference - dashLen}`} strokeDashoffset={-offset} transform="rotate(-90 80 80)" />
          );
        })}
        <text x={80} y={76} textAnchor="middle" fill="white" className="text-2xl font-bold">{avgScore}</text>
        <text x={80} y={94} textAnchor="middle" fill="#94A3B8" className="text-[10px]">estimado</text>
      </svg>
      <div className="space-y-1">
        {data.map((d) => (
          <div key={d.stars} className="flex items-center gap-2 text-xs">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: d.color }} />
            <span className="text-slate-400">{satisfactionLevelLabel(d.stars)}</span>
            <span className="text-white font-medium">{d.count}</span>
            <span className="text-slate-500">({Math.round((d.count / total) * 100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Colores por etapa del embudo (alineados con LIFECYCLE_STAGES del backend).
// Funcionan en claro y oscuro: son colores sólidos sobre pista translúcida.
const FUNNEL_COLORS = ['#38BDF8', '#818CF8', '#F59E0B', '#10B981'];

/**
 * Serie temporal (14 días por defecto, o el rango elegido): mensajes como barras + conversaciones nuevas como
 * línea, ambas en la misma escala (máximo combinado) para que la comparación sea
 * honesta. Colores vía clases/currentColor para legibilidad en claro y oscuro.
 */
function TimeSeriesChart({ data }: { data: AnalyticsTimeseriesPoint[] }) {
  if (data.length === 0) {
    return <p className="text-xs text-slate-500">Sin datos en el período elegido.</p>;
  }

  const max = Math.max(...data.map((d) => Math.max(d.messages, d.conversations)), 1);
  const W = 580, H = 210, padL = 30, padR = 8, padT = 12, padB = 26;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const n = data.length;
  const slot = chartW / n;
  const barW = slot * 0.5;
  const cx = (i: number) => padL + slot * i + slot / 2;
  const cy = (v: number) => padT + chartH - (v / max) * chartH;

  const linePts = data.map((d, i) => `${cx(i)},${cy(d.conversations)}`).join(' ');
  const ticks = [0, max / 2, max];

  return (
    <div>
      <div className="flex items-center gap-4 mb-3 text-[10px]">
        <span className="flex items-center gap-1.5 text-slate-400">
          <span className="inline-block w-3 h-2 rounded-sm bg-brand-400" /> Mensajes
        </span>
        <span className="flex items-center gap-1.5 text-slate-400">
          <span className="inline-block w-3 h-[2px] rounded-sm bg-emerald-400" /> Conversaciones nuevas
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
        aria-label={`Serie temporal de mensajes y conversaciones nuevas de los últimos ${n} días`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} y1={cy(t)} x2={W - padR} y2={cy(t)} stroke="currentColor" className="text-slate-700/40" strokeWidth={1} />
            <text x={padL - 6} y={cy(t) + 3} textAnchor="end" className="fill-slate-500 text-[9px]">{Math.round(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const h = (d.messages / max) * chartH;
          return (
            <rect key={d.date} x={cx(i) - barW / 2} y={padT + chartH - h} width={barW} height={h}
              rx={2} className="fill-brand-400" opacity={0.7} />
          );
        })}
        <polyline points={linePts} fill="none" stroke="currentColor" className="text-emerald-400" strokeWidth={2}
          strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => (
          <circle key={d.date} cx={cx(i)} cy={cy(d.conversations)} r={2.5} className="fill-emerald-400" />
        ))}
        {data.map((d, i) => (
          // Etiquetas espaciadas para no amontonar (1 de cada 2 con 14 días; menos con rangos largos).
          i % Math.max(2, Math.ceil(n / 8)) === 0 ? (
            <text key={d.date} x={cx(i)} y={H - 8} textAnchor="middle" className="fill-slate-500 text-[8px]">{d.label}</text>
          ) : null
        ))}
      </svg>
    </div>
  );
}

/**
 * Embudo del ciclo de vida CRM: una barra por etapa (ancho ∝ cantidad) con el
 * porcentaje del total y la conversión respecto de la etapa anterior.
 */
function FunnelChart({ funnel }: { funnel: AnalyticsFunnel }) {
  if (funnel.total === 0) {
    return <p className="text-xs text-slate-500">Todavía no hay contactos para armar el embudo.</p>;
  }
  const maxCount = Math.max(...funnel.stages.map((s) => s.count), 1);

  return (
    <div className="space-y-1">
      {funnel.stages.map((s, i) => (
        <div key={s.stage}>
          {i > 0 && s.conversionFromPrev !== null && (
            <div className="flex items-center gap-1 text-[10px] text-slate-500 pl-[88px] py-0.5">
              <ChevronDown className="h-3 w-3" />
              <span className="font-medium text-slate-400">{s.conversionFromPrev}%</span> de conversión
            </div>
          )}
          <div className="flex items-center gap-3">
            <div className="w-20 text-xs text-slate-400 shrink-0 text-right">{s.label}</div>
            <div className="flex-1 h-8 bg-surface-100 rounded-md overflow-hidden">
              <div
                className="h-full rounded-md flex items-center px-2 text-[11px] font-semibold text-white transition-all"
                style={{
                  width: `${Math.max((s.count / maxCount) * 100, s.count > 0 ? 10 : 0)}%`,
                  backgroundColor: FUNNEL_COLORS[i % FUNNEL_COLORS.length],
                }}
              >
                {s.count}
              </div>
            </div>
            <div className="w-10 text-right text-[10px] text-slate-500 shrink-0">{s.pctOfTotal}%</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Embudo por origen Click-to-WhatsApp: total atribuidas vs total + el top de
 * anuncios (headline + count, como barras). Si no hay conversaciones atribuidas,
 * muestra un empty state que explica qué es CTWA.
 */
function AttributionPanel({ attribution }: { attribution: AnalyticsAttribution | null }) {
  if (!attribution || attribution.attributed === 0) {
    return (
      <EmptyState
        icon={Megaphone}
        title="Todavía no hay conversaciones desde anuncios"
        description="Click-to-WhatsApp (CTWA) registra de qué anuncio de Meta vino cada charla. Cuando un cliente te escriba tocando un anuncio, vas a ver acá qué campañas traen más conversaciones y cerrás el loop de ROI."
      />
    );
  }

  const { total, attributed, byAd } = attribution;
  const pct = total > 0 ? Math.round((attributed / total) * 100) : 0;
  const maxCount = Math.max(...byAd.map((a) => a.count), 1);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-2xl font-bold text-white">
          {attributed}
          <span className="text-sm font-normal text-slate-500"> / {total} conversaciones</span>
        </p>
        <p className="text-[10px] text-slate-500">{pct}% vino de un anuncio (Click-to-WhatsApp)</p>
        <div className="h-2 bg-surface-100 rounded-full overflow-hidden mt-2">
          <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {byAd.length > 0 ? (
        <div className="space-y-2">
          <p className="mono-label">TOP ANUNCIOS POR VOLUMEN</p>
          {byAd.map((ad, i) => (
            <div key={ad.sourceId || ad.headline || i}>
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs text-slate-300 truncate flex items-center gap-1.5">
                  <Megaphone className="h-3 w-3 text-brand-400 shrink-0" />
                  {ad.headline || ad.sourceId || 'Anuncio sin título'}
                </span>
                <span className="text-[10px] text-slate-500 shrink-0">{ad.count}</span>
              </div>
              <div className="h-1.5 bg-surface-100 rounded-full overflow-hidden">
                <div className="h-full bg-brand-400 rounded-full transition-all" style={{ width: `${(ad.count / maxCount) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-500">Hay conversaciones atribuidas pero sin datos del anuncio.</p>
      )}
    </div>
  );
}

export default function AnalisisPage() {
  const [range, setRange] = useState<RangeSelection>(DEFAULT_RANGE);
  const { kpi, conversations, satisfaction, improvements, costs, metrics, timeseries, funnel, attribution, isLoading, error, refetch } = useAnalytics(range);
  const { campaigns, isLoading: campaignsLoading, error: campaignsError, createCampaign, deleteCampaign } = useCampaigns();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<TabId>('insights');

  // Exporta lo que se ve en la pestaña activa (datos ya cargados, sin pedidos extra).
  const handleExport = () => {
    downloadCsv(
      exportFilename(`analisis-${activeTab}`, rangeKey(range), todayLocalKey()),
      buildAnalyticsRows({ tab: activeTab, range, kpi, conversations, satisfaction, improvements, costs, metrics, timeseries, funnel, attribution }),
    );
  };
  const failed = error !== null;
  const rangeBar = (
    <DateRangeBar value={range} onChange={setRange} onExport={handleExport} exportDisabled={isLoading || failed || activeTab === 'campanas'} />
  );
  // Con error de carga NO se muestran ceros como si fueran datos reales: las tarjetas
  // dicen "—" y las pestañas con datos se ocultan (queda el aviso de error con reintento).
  const NA = '—';
  const costText = costLabels(range);
  const vsLabel = kpi.range?.custom ? 'vs período ant.' : 'vs mes ant.';
  const [showNewCampaign, setShowNewCampaign] = useState(false);
  const [campaignName, setCampaignName] = useState('');
  const [campaignDesc, setCampaignDesc] = useState('');
  const [creatingCampaign, setCreatingCampaign] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [deletingCampaign, setDeletingCampaign] = useState(false);

  async function handleDeleteCampaign() {
    if (!pendingDelete) return;
    setDeletingCampaign(true);
    try {
      await deleteCampaign(pendingDelete.id);
      toast({ type: 'success', message: 'Campaña eliminada correctamente' });
    } catch (err) {
      toast({ type: 'error', message: err instanceof Error && err.message ? err.message : 'Error al eliminar la campaña' });
    } finally {
      setDeletingCampaign(false);
      setPendingDelete(null);
    }
  }

  // Mejoras ya resueltas (aplicadas/ignoradas), recordadas entre recargas.
  const [resolved, setResolved] = useState<Record<string, 'aplicada' | 'ignorada'>>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem(RESOLVED_IMPROVEMENTS_KEY);
      if (raw) setResolved(JSON.parse(raw));
    } catch { /* localStorage no disponible */ }
  }, []);

  const resolveImprovement = (title: string, kind: 'aplicada' | 'ignorada') => {
    setResolved((prev) => {
      const next = { ...prev, [title]: kind };
      try { localStorage.setItem(RESOLVED_IMPROVEMENTS_KEY, JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
    toast({
      type: 'success',
      message: kind === 'aplicada' ? 'Mejora marcada como aplicada' : 'Sugerencia ignorada',
    });
  };

  const visibleImprovements = improvements.filter((i) => !resolved[i.title]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        {rangeBar}
        <LoadingSpinner label="Cargando análisis..." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {rangeBar}

      {error && <ErrorAlert message={error} onRetry={refetch} />}

      <p className="text-sm text-slate-400 max-w-2xl">
        Las herramientas del dashboard para <strong className="text-white">leer los datos de tu bot</strong> —
        qué pasó en las conversaciones, cómo mejorarlo, cuánto gastas y cómo va en el tiempo.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card-accent">
          <div className="flex items-center gap-2 mb-1"><MessageCircle className="h-4 w-4 text-brand-400" /><span className="text-[10px] text-slate-500">CONVERSACIONES</span></div>
          <p className="text-2xl font-bold text-white">{failed ? NA : kpi.totalConversations}</p>
          {!failed && (
            <p className={`text-[10px] ${kpi.conversationsChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {kpi.conversationsChange >= 0 ? '+' : ''}{kpi.conversationsChange}% {vsLabel}
            </p>
          )}
        </div>
        <div className="card-accent">
          <div className="flex items-center gap-2 mb-1"><Activity className="h-4 w-4 text-yellow-400" /><span className="text-[10px] text-slate-500 uppercase">{SATISFACTION_LABEL}</span></div>
          <p className="text-2xl font-bold text-white">{failed ? NA : <>{kpi.avgSatisfaction}<span className="text-sm text-slate-500">/5</span></>}</p>
          {!failed && (
            <p className={`text-[10px] ${kpi.satisfactionChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {kpi.satisfactionChange >= 0 ? '+' : ''}{kpi.satisfactionChange} {vsLabel}
            </p>
          )}
          <p className="text-[10px] text-slate-500 mt-1 leading-snug">{SATISFACTION_HELP}</p>
        </div>
        <div className="card-accent">
          <div className="flex items-center gap-2 mb-1"><DollarSign className="h-4 w-4 text-emerald-400" /><span className="text-[10px] text-slate-500 uppercase">{costText.cost}</span></div>
          <p className="text-2xl font-bold text-white">{failed ? NA : `$${kpi.monthlyAiCost}`}</p>
          {!failed && <p className="text-[10px] text-slate-400">de ${kpi.monthlyBudget} presupuesto</p>}
        </div>
        <div className="card-accent">
          <div className="flex items-center gap-2 mb-1"><Zap className="h-4 w-4 text-purple-400" /><span className="text-[10px] text-slate-500">CONVERSIÓN</span></div>
          <p className="text-2xl font-bold text-white">{failed ? NA : `${kpi.conversionRate}%`}</p>
          {!failed && (
            <p className={`text-[10px] ${kpi.conversionChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {kpi.conversionChange >= 0 ? '+' : ''}{kpi.conversionChange}% {vsLabel}
            </p>
          )}
        </div>
      </div>

      <div className="flex gap-1 border-b border-slate-700/50 overflow-x-auto">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors whitespace-nowrap border-b-2 ${
                activeTab === tab.id ? 'border-brand-400 text-brand-400' : 'border-transparent text-slate-400 hover:text-white'
              }`}
            ><Icon className="h-3.5 w-3.5" />{tab.label}</button>
          );
        })}
      </div>

      {activeTab === 'insights' && !failed && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card-accent"><h3 className="font-semibold text-white mb-4">Conversaciones por día</h3><BarChart data={conversations} /></div>
          <div className="card-accent"><h3 className="font-semibold text-white mb-1">{SATISFACTION_LABEL}</h3><p className="text-[11px] text-slate-500 mb-4">{SATISFACTION_HELP}</p><SatisfactionRing data={satisfaction} avgScore={kpi.avgSatisfaction} /></div>
        </div>
      )}

      {activeTab === 'mejoras' && !failed && (
        <div className="space-y-3">
          {visibleImprovements.map((item) => (
            <div key={item.id} className="card-accent">
              <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className={`h-4 w-4 ${item.severity === 'alta' ? 'text-red-400' : item.severity === 'media' ? 'text-yellow-400' : 'text-slate-400'}`} />
                  <h4 className="text-sm font-medium text-white">{item.title}</h4>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-500">{item.category}</span>
                  <span className={`badge border text-[9px] ${severityColors[item.severity as keyof typeof severityColors]}`}>{item.severity}</span>
                </div>
              </div>
              <p className="text-xs text-slate-400 mb-3">{item.description}</p>
              <div className="flex gap-2">
                <button onClick={() => resolveImprovement(item.title, 'aplicada')} className="btn-primary text-xs py-1">Aplicar mejora</button>
                <button onClick={() => resolveImprovement(item.title, 'ignorada')} className="btn-secondary text-xs py-1">Ignorar</button>
              </div>
            </div>
          ))}
          {visibleImprovements.length === 0 && (
            <EmptyState
              icon={CheckCircle2}
              title="Todo al día"
              description={improvements.length > 0
                ? 'Ya revisaste todas las sugerencias. Volverán a aparecer si la situación cambia.'
                : 'No hay sugerencias de mejora por ahora. Buen trabajo.'}
            />
          )}
        </div>
      )}

      {activeTab === 'estadisticas' && !failed && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card-accent"><h3 className="font-semibold text-white mb-4">Conversaciones por día</h3><BarChart data={conversations} /></div>
          <div className="card-accent">
            <h3 className="font-semibold text-white mb-4">Métricas clave</h3>
            <div className="space-y-3">
              {metrics.map((m) => (
                <div key={m.label} className="flex justify-between items-center">
                  <span className="text-xs text-slate-400">{m.label}</span>
                  <span className="text-sm font-medium text-white">{m.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'reportes' && !failed && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card-accent">
              <h3 className="font-semibold text-white mb-1 flex items-center gap-2">
                <LineChart className="h-4 w-4 text-brand-400" /> Actividad últimos {timeseries.length || 14} días
              </h3>
              <p className="mono-label mb-4">MENSAJES Y CONVERSACIONES NUEVAS POR DÍA</p>
              <TimeSeriesChart data={timeseries} />
            </div>
            <div className="card-accent">
              <h3 className="font-semibold text-white mb-1 flex items-center gap-2">
                <Filter className="h-4 w-4 text-brand-400" /> Embudo de conversión
              </h3>
              <p className="mono-label mb-4">
                CICLO DE VIDA CRM{funnel ? ` · ${funnel.total} contactos` : ''}
              </p>
              {funnel ? (
                <FunnelChart funnel={funnel} />
              ) : (
                <p className="text-xs text-slate-500">Sin datos del embudo.</p>
              )}
            </div>
          </div>
          <div className="card-accent">
            <h3 className="font-semibold text-white mb-1 flex items-center gap-2">
              <Megaphone className="h-4 w-4 text-brand-400" /> Origen de las conversaciones (Click-to-WhatsApp)
            </h3>
            <p className="mono-label mb-4">DE QUÉ ANUNCIO VINO CADA CHARLA</p>
            <AttributionPanel attribution={attribution} />
          </div>
        </div>
      )}

      {activeTab === 'costos' && !failed && (
        <div className="card-accent">
          <h3 className="font-semibold text-white mb-4">Desglose de costos IA</h3>
          <div className="mb-4">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-400">{costText.budget}</span>
              <span className="text-white">${kpi.monthlyAiCost} / ${kpi.monthlyBudget}</span>
            </div>
            <div className="h-2 bg-surface-100 rounded-full overflow-hidden">
              <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${(kpi.monthlyAiCost / kpi.monthlyBudget) * 100}%` }} />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-slate-700/50"><th className="text-left text-slate-500 py-2 font-medium">Modelo</th><th className="text-right text-slate-500 py-2 font-medium">Tokens</th><th className="text-right text-slate-500 py-2 font-medium">Costo</th></tr></thead>
              <tbody>
                {costs.map((row) => (
                  <tr key={row.model} className="border-b border-slate-800">
                    <td className="py-2 text-white">{row.model}</td>
                    <td className="py-2 text-right text-slate-400">{row.tokens > 0 ? (row.tokens / 1_000_000).toFixed(1) + 'M' : '—'}</td>
                    <td className="py-2 text-right text-white font-medium">${row.cost.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t border-slate-700"><td className="py-2 text-white font-medium">Total</td><td /><td className="py-2 text-right text-brand-400 font-bold">${kpi.monthlyAiCost}</td></tr></tfoot>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'campanas' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-400">Mandá mensajes a tus segmentos de clientes por WhatsApp — promociones, avisos, seguimientos.</p>
            <button onClick={() => setShowNewCampaign(!showNewCampaign)} className="btn-primary text-xs">
              <Plus className="h-3.5 w-3.5" /> Nueva campaña
            </button>
          </div>

          {showNewCampaign && (
            <div className="card-accent">
              <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                <Megaphone className="h-4 w-4 text-brand-400" /> Crear campaña
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Nombre</label>
                  <input type="text" value={campaignName} onChange={(e) => setCampaignName(e.target.value)} placeholder="Promo verano 2026" className="input w-full" />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Descripción</label>
                  <input type="text" value={campaignDesc} onChange={(e) => setCampaignDesc(e.target.value)} placeholder="Descuento 20% en todos los servicios" className="input w-full" />
                </div>
              </div>
              <div className="flex justify-end mt-3 gap-2">
                <button onClick={() => setShowNewCampaign(false)} className="btn-secondary text-xs">Cancelar</button>
                <button
                  onClick={async () => {
                    if (!campaignName.trim()) return;
                    setCreatingCampaign(true);
                    try {
                      await createCampaign({ name: campaignName.trim(), description: campaignDesc.trim() || null, channel: 'whatsapp' });
                      setCampaignName('');
                      setCampaignDesc('');
                      setShowNewCampaign(false);
                    } catch (err) {
                      toast({ type: 'error', message: err instanceof Error && err.message ? err.message : 'Error al crear la campaña' });
                    } finally { setCreatingCampaign(false); }
                  }}
                  disabled={creatingCampaign || !campaignName.trim()}
                  className="btn-primary text-xs disabled:opacity-50"
                >
                  {creatingCampaign ? 'Creando...' : 'Crear'}
                </button>
              </div>
            </div>
          )}

          <ConfirmDialog
            isOpen={pendingDelete !== null}
            onClose={() => { if (!deletingCampaign) setPendingDelete(null); }}
            onConfirm={handleDeleteCampaign}
            title="Eliminar campaña"
            message={`¿Eliminar la campaña "${pendingDelete?.name ?? ''}"? No se puede deshacer.`}
            confirmLabel="Eliminar"
            variant="danger"
            loading={deletingCampaign}
          />

          {campaignsLoading ? (
            <LoadingSpinner label="Cargando campañas..." />
          ) : campaignsError ? (
            <ErrorAlert message={campaignsError} />
          ) : campaigns.length === 0 ? (
            <EmptyState icon={BarChart3} title="Sin datos" description="Creá tu primera campaña para enviar mensajes masivos por WhatsApp." />
          ) : (
            <div className="space-y-2">
              {campaigns.map((c) => (
                <div key={c.id} className="card flex flex-wrap items-center gap-4">
                  <div className="h-9 w-9 rounded-lg bg-brand-400/10 flex items-center justify-center shrink-0">
                    <Send className="h-4 w-4 text-brand-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{c.name}</p>
                    {c.description && <p className="text-xs text-slate-500 truncate">{c.description}</p>}
                  </div>
                  {(() => {
                    const info = describeCampaignStatus(c);
                    return (
                      <span title={info.description} className={`badge border text-[9px] ${info.className}`}>{info.label}</span>
                    );
                  })()}
                  <span className="text-[10px] text-slate-500 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {new Date(c.createdAt).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}
                  </span>
                  <button onClick={() => setPendingDelete({ id: c.id, name: c.name })} aria-label={`Eliminar ${c.name}`} className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition-colors">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
