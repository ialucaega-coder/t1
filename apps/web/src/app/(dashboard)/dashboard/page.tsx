'use client';

import { useState, useEffect } from 'react';
import {
  Calendar, Sparkles, ShoppingBag, Users, Bot, Plus, Pause, Play, Trash2,
  MessageSquare, ExternalLink, Code, Check, Activity, Crown,
  ArrowUpRight, ArrowDownRight, Bell, TrendingUp, Zap, AlertTriangle,
} from 'lucide-react';
import Link from 'next/link';
import { useStats } from '@/hooks/use-stats';
import { useBots } from '@/hooks/use-bots';
import { useSocket, useSocketEvent } from '@/hooks/use-socket';
import { useAuth } from '@/lib/auth-context';
import { statsApi } from '@/lib/api/index';
import type { DashboardStats } from '@/types';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';

const CHANNEL_LABELS: Record<string, { label: string; color: string }> = {
  TELEGRAM: { label: 'Telegram', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  WHATSAPP: { label: 'WhatsApp', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  WEBCHAT: { label: 'Web Chat', color: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
  INSTAGRAM: { label: 'Instagram', color: 'bg-pink-500/10 text-pink-400 border-pink-500/20' },
};

const STATUS_LABELS: Record<string, { label: string; color: string; dot: string }> = {
  ACTIVE: { label: 'Activo', color: 'text-emerald-400', dot: 'bg-emerald-400' },
  PAUSED: { label: 'Pausado', color: 'text-yellow-400', dot: 'bg-yellow-400' },
  DRAFT: { label: 'Borrador', color: 'text-slate-400', dot: 'bg-slate-400' },
  ERROR: { label: 'Error', color: 'text-red-400', dot: 'bg-red-400' },
};

const TIER_COLORS: Record<string, string> = {
  FREE: 'text-slate-400',
  STARTER: 'text-blue-400',
  PRO: 'text-brand-400',
  ENTERPRISE: 'text-amber-400',
};

function UsageBar({ used, max, label }: { used: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min((used / max) * 100, 100) : 0;
  const isHigh = pct > 80;
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-slate-400">{label}</span>
        <span className={isHigh ? 'text-amber-400' : 'text-slate-300'}>
          {used.toLocaleString()} / {max.toLocaleString()}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-700 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${isHigh ? 'bg-amber-400' : 'bg-brand-400'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export default function DashboardPage() {
  const { overview, isLoading: statsLoading, error: statsError, refetch: refetchStats } = useStats();
  const { bots, isLoading: botsLoading, error: botsError, refetch: refetchBots, createBot, updateBot, deleteBot } = useBots();
  const { business } = useAuth();
  useSocket(business?.id ?? null);
  useSocketEvent('booking:created', () => {
    refetchStats();
    statsApi.getDashboard().then(setDashboard).catch(() => {});
  });
  useSocketEvent('conversation:new-message', () => {
    statsApi.getDashboard().then(setDashboard).catch(() => {});
  });
  const [dashboard, setDashboard] = useState<DashboardStats | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newBotName, setNewBotName] = useState('');
  const [newBotChannel, setNewBotChannel] = useState<'TELEGRAM' | 'WHATSAPP' | 'WEBCHAT' | 'INSTAGRAM'>('WHATSAPP');
  const [newBotDesc, setNewBotDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    statsApi.getDashboard().then(setDashboard).catch(() => {});
  }, []);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const isLoading = statsLoading || botsLoading;
  const error = statsError || botsError;

  const handleCreate = async () => {
    if (!newBotName.trim()) return;
    setCreating(true);
    try {
      await createBot({ name: newBotName.trim(), description: newBotDesc.trim() || null, channel: newBotChannel });
      setNewBotName('');
      setNewBotDesc('');
      setShowCreate(false);
    } catch { /* error via hook */ }
    finally { setCreating(false); }
  };

  const handleToggleStatus = async (bot: { id: string; status: string }) => {
    const newStatus = bot.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    await updateBot(bot.id, { status: newStatus as any });
  };

  const handleDelete = async (id: string) => {
    await deleteBot(id);
  };

  if (isLoading) return <LoadingSpinner label="Cargando dashboard..." />;

  const conv = dashboard?.conversations;
  const sub = dashboard?.subscription;

  return (
    <div className="space-y-8">
      {error && <ErrorAlert message={error} onRetry={() => { refetchStats(); refetchBots(); }} />}

      {/* Quick Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Link href="/reservas" className="card group">
          <div className="flex items-center justify-between mb-2">
            <Calendar className="h-5 w-5 text-brand-400" />
            <span className="text-2xl font-bold text-white">{overview?.todayBookings ?? 0}</span>
          </div>
          <p className="text-sm text-slate-400 group-hover:text-slate-300">Reservas hoy</p>
          {overview?.bookingChange && (
            <p className={`text-xs mt-1 flex items-center gap-0.5 ${overview.bookingChange.startsWith('+') ? 'text-emerald-400' : 'text-red-400'}`}>
              {overview.bookingChange.startsWith('+') ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              {overview.bookingChange} vs mes anterior
            </p>
          )}
        </Link>

        <Link href="/conversaciones" className="card group">
          <div className="flex items-center justify-between mb-2">
            <MessageSquare className="h-5 w-5 text-sky-400" />
            <span className="text-2xl font-bold text-white">{conv?.open ?? 0}</span>
          </div>
          <p className="text-sm text-slate-400 group-hover:text-slate-300">Conversaciones abiertas</p>
          {conv && conv.todayMessages > 0 && (
            <p className="text-xs mt-1 text-slate-500">{conv.todayMessages} mensajes hoy</p>
          )}
        </Link>

        <Link href="/clientes" className="card group">
          <div className="flex items-center justify-between mb-2">
            <Users className="h-5 w-5 text-violet-400" />
            <span className="text-2xl font-bold text-white">{overview?.totalClients ?? 0}</span>
          </div>
          <p className="text-sm text-slate-400 group-hover:text-slate-300">Clientes</p>
        </Link>

        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <TrendingUp className="h-5 w-5 text-emerald-400" />
            <span className="text-2xl font-bold text-white">
              ${overview?.revenue ? overview.revenue.toLocaleString() : '0'}
            </span>
          </div>
          <p className="text-sm text-slate-400">Ingresos del mes</p>
          {overview?.revenueChange && (
            <p className={`text-xs mt-1 flex items-center gap-0.5 ${overview.revenueChange.startsWith('+') ? 'text-emerald-400' : 'text-red-400'}`}>
              {overview.revenueChange.startsWith('+') ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              {overview.revenueChange} vs mes anterior
            </p>
          )}
        </div>
      </div>

      {/* Middle row: Subscription + Conversations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Subscription Card */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="mono-label">PLAN ACTUAL</h3>
            <Link href="/facturacion" className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1">
              Gestionar <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
          {sub ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-brand-400/10 flex items-center justify-center">
                  <Crown className={`h-5 w-5 ${TIER_COLORS[sub.planTier] || 'text-brand-400'}`} />
                </div>
                <div>
                  <p className="text-white font-semibold">{sub.planName}</p>
                  <p className="text-xs text-slate-500">
                    {sub.status === 'ACTIVE' ? 'Activo' : sub.status === 'TRIALING' ? 'Prueba' : sub.status} — vence {new Date(sub.currentPeriodEnd).toLocaleDateString('es-AR')}
                  </p>
                </div>
              </div>
              <div className="space-y-2.5">
                <UsageBar used={dashboard?.bots.total ?? 0} max={sub.maxBots} label="Bots" />
                <UsageBar used={conv?.monthMessages ?? 0} max={sub.maxMessages} label="Mensajes (mes)" />
                <UsageBar used={overview?.totalClients ?? 0} max={sub.maxContacts} label="Contactos" />
              </div>
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-slate-400 mb-2">Sin plan activo</p>
              <Link href="/facturacion" className="btn-primary text-xs inline-flex">
                <Zap className="h-3.5 w-3.5" /> Elegir plan
              </Link>
            </div>
          )}
        </div>

        {/* Conversations Summary */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="mono-label">CONVERSACIONES</h3>
            <Link href="/conversaciones" className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1">
              Ver todas <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
          {conv ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-surface p-3">
                <p className="text-2xl font-bold text-white">{conv.open}</p>
                <p className="text-xs text-slate-500 mt-0.5">Abiertas</p>
              </div>
              <div className="rounded-lg bg-surface p-3">
                <p className="text-2xl font-bold text-amber-400">{conv.handoff}</p>
                <p className="text-xs text-slate-500 mt-0.5">Esperando humano</p>
              </div>
              <div className="rounded-lg bg-surface p-3">
                <p className="text-2xl font-bold text-white">{conv.todayMessages}</p>
                <p className="text-xs text-slate-500 mt-0.5">Mensajes hoy</p>
              </div>
              <div className="rounded-lg bg-surface p-3">
                <p className="text-2xl font-bold text-white">{conv.total}</p>
                <p className="text-xs text-slate-500 mt-0.5">Total histórico</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {[0, 0, 0, 0].map((_, i) => (
                <div key={i} className="rounded-lg bg-surface p-3 animate-pulse">
                  <div className="h-7 w-10 bg-slate-700 rounded mb-1" />
                  <div className="h-3 w-16 bg-slate-700 rounded" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bots Section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h3 className="mono-label">MIS BOTS</h3>
            {dashboard?.bots && (
              <span className="text-xs text-slate-500">
                {dashboard.bots.active} activo{dashboard.bots.active !== 1 ? 's' : ''} de {dashboard.bots.total}
              </span>
            )}
          </div>
          <button onClick={() => setShowCreate(!showCreate)} className="btn-primary text-xs">
            <Plus className="h-3.5 w-3.5" /> Crear bot
          </button>
        </div>

        {showCreate && (
          <div className="card-accent mb-4">
            <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Bot className="h-4 w-4 text-brand-400" /> Nuevo bot
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Nombre</label>
                <input type="text" value={newBotName} onChange={(e) => setNewBotName(e.target.value)} placeholder="Mi bot de reservas" className="input w-full" />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Canal</label>
                <select value={newBotChannel} onChange={(e) => setNewBotChannel(e.target.value as any)} className="input w-full">
                  <option value="WHATSAPP">WhatsApp</option>
                  <option value="TELEGRAM">Telegram</option>
                  <option value="WEBCHAT">Web Chat</option>
                  <option value="INSTAGRAM">Instagram</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Descripción</label>
                <input type="text" value={newBotDesc} onChange={(e) => setNewBotDesc(e.target.value)} placeholder="Opcional" className="input w-full" />
              </div>
            </div>
            <div className="flex justify-end mt-3 gap-2">
              <button onClick={() => setShowCreate(false)} className="btn-secondary text-xs">Cancelar</button>
              <button onClick={handleCreate} disabled={creating || !newBotName.trim()} className="btn-primary text-xs disabled:opacity-50">
                {creating ? 'Creando...' : 'Crear bot'}
              </button>
            </div>
          </div>
        )}

        {bots.length === 0 ? (
          <div className="card-accent">
            <p className="mono-label mb-2">SIN BOTS TODAVÍA</p>
            <h3 className="text-lg font-bold text-white mb-3">
              Crea tu primer bot o conéctalo con el CLI.
            </h3>
            <div className="rounded-lg bg-surface p-4 font-mono text-sm space-y-3 mb-4">
              <div>
                <span className="text-brand-500">{'>'}</span>{' '}
                <span className="font-semibold text-white">npx localb init</span>
                <p className="text-slate-500 ml-4"># tu agente construye y publica el bot</p>
              </div>
              <div>
                <span className="text-brand-500">{'>'}</span>{' '}
                <span className="font-semibold text-white">localb login</span>
                <p className="text-slate-500 ml-4"># entra con esta misma cuenta — el pairing es automático</p>
              </div>
            </div>
            <p className="text-sm text-slate-400">
              O usa el botón <strong className="text-white">Crear bot</strong> de arriba para configurarlo directo desde el panel.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {bots.map((bot) => {
              const channel = CHANNEL_LABELS[bot.channel] || CHANNEL_LABELS.WEBCHAT;
              const status = STATUS_LABELS[bot.status] || STATUS_LABELS.DRAFT;
              return (
                <div key={bot.id} className="card flex items-center gap-4">
                  <div className="h-10 w-10 rounded-lg bg-brand-400/10 flex items-center justify-center shrink-0">
                    <Bot className="h-5 w-5 text-brand-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Link href={`/bots/${bot.id}`} className="text-sm font-medium text-white truncate hover:text-brand-400 transition-colors">{bot.name}</Link>
                      <div className="flex items-center gap-1">
                        <div className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                        <span className={`text-[10px] ${status.color}`}>{status.label}</span>
                      </div>
                    </div>
                    {bot.description && <p className="text-xs text-slate-500 truncate">{bot.description}</p>}
                  </div>
                  <span className={`badge border text-[9px] ${channel.color}`}>{channel.label}</span>
                  <div className="flex items-center gap-1 text-xs text-slate-500">
                    <MessageSquare className="h-3 w-3" />
                    <span>{bot._count?.conversations ?? bot.messageCount}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {bot.status === 'ACTIVE' && (
                      <>
                        <a href={`/chat/${bot.id}`} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-lg hover:bg-surface-100 text-slate-400 hover:text-brand-400 transition-colors" title="Abrir webchat">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                        <button onClick={() => copyToClipboard(`<iframe src="${window.location.origin}/chat/${bot.id}" width="400" height="600" frameborder="0"></iframe>`, bot.id)} className="p-1.5 rounded-lg hover:bg-surface-100 text-slate-400 hover:text-brand-400 transition-colors" title="Copiar código embed">
                          {copiedId === bot.id ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Code className="h-3.5 w-3.5" />}
                        </button>
                      </>
                    )}
                    <button onClick={() => handleToggleStatus(bot)} className="p-1.5 rounded-lg hover:bg-surface-100 text-slate-400 hover:text-white transition-colors" title={bot.status === 'ACTIVE' ? 'Pausar' : 'Activar'}>
                      {bot.status === 'ACTIVE' ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    </button>
                    <button onClick={() => handleDelete(bot.id)} className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition-colors" title="Eliminar">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom row: Recent Activity + Quick Links */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recent Activity */}
        <div className="lg:col-span-2 card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="mono-label">ACTIVIDAD RECIENTE</h3>
          </div>
          {dashboard?.recentActivity && dashboard.recentActivity.length > 0 ? (
            <div className="space-y-2">
              {dashboard.recentActivity.map((item) => (
                <div key={item.id} className="flex items-start gap-3 py-2 border-b border-slate-700/50 last:border-0">
                  <div className={`mt-0.5 h-7 w-7 rounded-lg flex items-center justify-center shrink-0 ${
                    item.type === 'GENERAL' ? 'bg-blue-500/10' : item.type === 'BOOKING' ? 'bg-emerald-500/10' : 'bg-slate-700'
                  }`}>
                    {item.type === 'BOOKING' ? (
                      <Calendar className="h-3.5 w-3.5 text-emerald-400" />
                    ) : item.title.includes('Handoff') || item.title.includes('insatisfecho') ? (
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                    ) : (
                      <Bell className="h-3.5 w-3.5 text-blue-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white">{item.title}</p>
                    <p className="text-xs text-slate-500 truncate">{item.body}</p>
                  </div>
                  <span className="text-[10px] text-slate-600 shrink-0">
                    {timeAgo(item.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center">
              <Activity className="h-8 w-8 text-slate-700 mx-auto mb-2" />
              <p className="text-sm text-slate-500">Sin actividad reciente</p>
            </div>
          )}
        </div>

        {/* Quick Links */}
        <div className="card">
          <h3 className="mono-label mb-4">ACCESO RÁPIDO</h3>
          <div className="space-y-2">
            {[
              { href: '/servicios', label: 'Servicios', icon: Sparkles, count: overview?.activeServices },
              { href: '/productos', label: 'Productos', icon: ShoppingBag, count: overview?.totalProducts },
              { href: '/superpoderes', label: 'Superpoderes', icon: Zap },
              { href: '/campanas', label: 'Campañas', icon: Activity },
              { href: '/analisis', label: 'Análisis', icon: TrendingUp },
            ].map((link) => {
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface transition-colors group"
                >
                  <Icon className="h-4 w-4 text-slate-500 group-hover:text-brand-400 transition-colors" />
                  <span className="text-sm text-slate-300 group-hover:text-white flex-1">{link.label}</span>
                  {link.count !== undefined && (
                    <span className="text-xs text-slate-600">{link.count}</span>
                  )}
                  <ArrowUpRight className="h-3 w-3 text-slate-600 group-hover:text-slate-400" />
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
