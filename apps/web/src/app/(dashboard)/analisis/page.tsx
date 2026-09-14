'use client';

import { useState } from 'react';
import { Brain, TrendingUp, BarChart3, DollarSign, Megaphone, MessageCircle, Star, Zap, AlertTriangle, Plus, Trash2, Send, Clock } from 'lucide-react';
import { useAnalytics } from '@/hooks/use-analytics';
import { useCampaigns } from '@/hooks/use-campaigns';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import { EmptyState } from '@/components/common/EmptyState';

const TABS = [
  { id: 'insights', label: 'Insights', icon: Brain },
  { id: 'mejoras', label: 'Mejoras', icon: TrendingUp },
  { id: 'estadisticas', label: 'Estadísticas', icon: BarChart3 },
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
  const barW = 36;
  const gap = 16;
  const totalW = data.length * (barW + gap) - gap;

  return (
    <svg viewBox={`0 0 ${totalW + 20} ${chartH + 30}`} className="w-full max-w-md">
      {data.map((d, i) => {
        const barH = (d.count / max) * chartH;
        const x = i * (barW + gap) + 10;
        const y = chartH - barH;
        return (
          <g key={d.day}>
            <rect x={x} y={y} width={barW} height={barH} rx={4} fill="#38BDF8" opacity={0.8} />
            <text x={x + barW / 2} y={y - 6} textAnchor="middle" className="text-[10px]" fill="#94A3B8">{d.count}</text>
            <text x={x + barW / 2} y={chartH + 16} textAnchor="middle" className="text-[10px]" fill="#64748B">{d.day}</text>
          </g>
        );
      })}
    </svg>
  );
}

function SatisfactionRing({ data, avgScore }: { data: { stars: number; count: number; color: string }[]; avgScore: number }) {
  const total = data.reduce((s, d) => s + d.count, 0);
  const r = 60;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="flex items-center gap-6">
      <svg viewBox="0 0 160 160" className="w-36 h-36">
        {data.map((d) => {
          const pct = d.count / total;
          const dashLen = pct * circumference;
          const segment = (
            <circle key={d.stars} cx={80} cy={80} r={r} fill="none" stroke={d.color} strokeWidth={18}
              strokeDasharray={`${dashLen} ${circumference - dashLen}`} strokeDashoffset={-offset} transform="rotate(-90 80 80)" />
          );
          offset += dashLen;
          return segment;
        })}
        <text x={80} y={76} textAnchor="middle" fill="white" className="text-2xl font-bold">{avgScore}</text>
        <text x={80} y={94} textAnchor="middle" fill="#94A3B8" className="text-[10px]">promedio</text>
      </svg>
      <div className="space-y-1">
        {data.map((d) => (
          <div key={d.stars} className="flex items-center gap-2 text-xs">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: d.color }} />
            <span className="text-slate-400">{d.stars}★</span>
            <span className="text-white font-medium">{d.count}</span>
            <span className="text-slate-500">({Math.round((d.count / total) * 100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AnalisisPage() {
  const { kpi, conversations, satisfaction, improvements, costs, metrics, isLoading, error, refetch } = useAnalytics();
  const { campaigns, isLoading: campaignsLoading, createCampaign, deleteCampaign } = useCampaigns();
  const [activeTab, setActiveTab] = useState<TabId>('insights');
  const [showNewCampaign, setShowNewCampaign] = useState(false);
  const [campaignName, setCampaignName] = useState('');
  const [campaignDesc, setCampaignDesc] = useState('');
  const [creatingCampaign, setCreatingCampaign] = useState(false);

  if (isLoading) return <LoadingSpinner label="Cargando análisis..." />;

  return (
    <div className="space-y-6">
      {error && <ErrorAlert message={error} onRetry={refetch} />}

      <p className="text-sm text-slate-400 max-w-2xl">
        Las herramientas del dashboard para <strong className="text-white">leer los datos de tu bot</strong> —
        qué pasó en las conversaciones, cómo mejorarlo, cuánto gastas y cómo va en el tiempo.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card-accent">
          <div className="flex items-center gap-2 mb-1"><MessageCircle className="h-4 w-4 text-brand-400" /><span className="text-[10px] text-slate-500">CONVERSACIONES</span></div>
          <p className="text-2xl font-bold text-white">{kpi.totalConversations}</p>
          <p className={`text-[10px] ${kpi.conversationsChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {kpi.conversationsChange >= 0 ? '+' : ''}{kpi.conversationsChange}% vs mes ant.
          </p>
        </div>
        <div className="card-accent">
          <div className="flex items-center gap-2 mb-1"><Star className="h-4 w-4 text-yellow-400" /><span className="text-[10px] text-slate-500">SATISFACCIÓN</span></div>
          <p className="text-2xl font-bold text-white">{kpi.avgSatisfaction}<span className="text-sm text-slate-500">/5</span></p>
          <p className={`text-[10px] ${kpi.satisfactionChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {kpi.satisfactionChange >= 0 ? '+' : ''}{kpi.satisfactionChange} vs mes ant.
          </p>
        </div>
        <div className="card-accent">
          <div className="flex items-center gap-2 mb-1"><DollarSign className="h-4 w-4 text-emerald-400" /><span className="text-[10px] text-slate-500">COSTO IA</span></div>
          <p className="text-2xl font-bold text-white">${kpi.monthlyAiCost}</p>
          <p className="text-[10px] text-slate-400">de ${kpi.monthlyBudget} presupuesto</p>
        </div>
        <div className="card-accent">
          <div className="flex items-center gap-2 mb-1"><Zap className="h-4 w-4 text-purple-400" /><span className="text-[10px] text-slate-500">CONVERSIÓN</span></div>
          <p className="text-2xl font-bold text-white">{kpi.conversionRate}%</p>
          <p className={`text-[10px] ${kpi.conversionChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {kpi.conversionChange >= 0 ? '+' : ''}{kpi.conversionChange}% vs mes ant.
          </p>
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

      {activeTab === 'insights' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card-accent"><h3 className="font-semibold text-white mb-4">Conversaciones por día</h3><BarChart data={conversations} /></div>
          <div className="card-accent"><h3 className="font-semibold text-white mb-4">Satisfacción del cliente</h3><SatisfactionRing data={satisfaction} avgScore={kpi.avgSatisfaction} /></div>
        </div>
      )}

      {activeTab === 'mejoras' && (
        <div className="space-y-3">
          {improvements.map((item) => (
            <div key={item.id} className="card-accent">
              <div className="flex items-start justify-between mb-2">
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
                <button className="btn-primary text-xs py-1">Aplicar mejora</button>
                <button className="btn-secondary text-xs py-1">Ignorar</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'estadisticas' && (
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

      {activeTab === 'costos' && (
        <div className="card-accent">
          <h3 className="font-semibold text-white mb-4">Desglose de costos IA</h3>
          <div className="mb-4">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-400">Presupuesto mensual</span>
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
          <div className="flex items-center justify-between">
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
                    } catch {}
                    finally { setCreatingCampaign(false); }
                  }}
                  disabled={creatingCampaign || !campaignName.trim()}
                  className="btn-primary text-xs disabled:opacity-50"
                >
                  {creatingCampaign ? 'Creando...' : 'Crear'}
                </button>
              </div>
            </div>
          )}

          {campaignsLoading ? (
            <LoadingSpinner label="Cargando campañas..." />
          ) : campaigns.length === 0 ? (
            <EmptyState icon={BarChart3} title="Sin datos" description="Creá tu primera campaña para enviar mensajes masivos por WhatsApp." />
          ) : (
            <div className="space-y-2">
              {campaigns.map((c) => (
                <div key={c.id} className="card flex items-center gap-4">
                  <div className="h-9 w-9 rounded-lg bg-brand-400/10 flex items-center justify-center shrink-0">
                    <Send className="h-4 w-4 text-brand-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{c.name}</p>
                    {c.description && <p className="text-xs text-slate-500 truncate">{c.description}</p>}
                  </div>
                  <span className={`badge border text-[9px] ${
                    c.status === 'SENT' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : c.status === 'SCHEDULED' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                    : 'bg-slate-500/10 text-slate-400 border-slate-500/20'
                  }`}>{c.status === 'SENT' ? 'Enviada' : c.status === 'SCHEDULED' ? 'Programada' : 'Borrador'}</span>
                  <span className="text-[10px] text-slate-500 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {new Date(c.createdAt).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}
                  </span>
                  <button onClick={() => deleteCampaign(c.id)} className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition-colors">
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
