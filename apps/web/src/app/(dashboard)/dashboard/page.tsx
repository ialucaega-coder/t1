'use client';

import { useState } from 'react';
import { Terminal, Sparkles, Calendar, ShoppingBag, Users, Bot, Plus, Pause, Play, Trash2, Settings, MessageSquare, Send, ExternalLink, Code, Copy, Check } from 'lucide-react';
import Link from 'next/link';
import { useStats } from '@/hooks/use-stats';
import { useBots } from '@/hooks/use-bots';
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

export default function DashboardPage() {
  const { overview, isLoading: statsLoading, error: statsError, refetch: refetchStats } = useStats();
  const { bots, isLoading: botsLoading, error: botsError, refetch: refetchBots, createBot, updateBot, deleteBot } = useBots();
  const [showCreate, setShowCreate] = useState(false);
  const [newBotName, setNewBotName] = useState('');
  const [newBotChannel, setNewBotChannel] = useState<'TELEGRAM' | 'WHATSAPP' | 'WEBCHAT' | 'INSTAGRAM'>('WHATSAPP');
  const [newBotDesc, setNewBotDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const isLoading = statsLoading || botsLoading;
  const error = statsError || botsError;

  const quickStats = [
    { label: 'Reservas hoy', value: overview ? String(overview.todayBookings) : '0', icon: Calendar, href: '/reservas' },
    { label: 'Servicios activos', value: overview ? String(overview.activeServices) : '0', icon: Sparkles, href: '/servicios' },
    { label: 'Productos', value: overview ? String(overview.totalProducts) : '0', icon: ShoppingBag, href: '/productos' },
    { label: 'Clientes', value: overview ? String(overview.totalClients) : '0', icon: Users, href: '/clientes' },
  ];

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

  return (
    <div className="space-y-8">
      {error && <ErrorAlert message={error} onRetry={() => { refetchStats(); refetchBots(); }} />}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {quickStats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Link key={stat.label} href={stat.href} className="card group">
              <div className="flex items-center justify-between mb-3">
                <Icon className="h-5 w-5 text-brand-400" />
                <span className="text-2xl font-bold text-white">{stat.value}</span>
              </div>
              <p className="text-sm text-slate-400 group-hover:text-slate-300">{stat.label}</p>
            </Link>
          );
        })}
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="mono-label">MIS BOTS</h3>
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
                      <p className="text-sm font-medium text-white truncate">{bot.name}</p>
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

      <div className="card-accent">
        <div className="flex items-start gap-3">
          <Sparkles className="h-5 w-5 text-brand-400 mt-0.5" />
          <div>
            <p className="mono-label mb-1">PLAN COMPLETO</p>
            <h3 className="text-lg font-bold text-white mb-2">
              Todas las funciones <span className="text-brand-400">desbloqueadas.</span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
              <div className="flex items-start gap-2">
                <span className="text-brand-400 mt-0.5">&#x2713;</span>
                <p className="text-sm text-slate-400">12 superpoderes activos: Blindaje, Vigilante, Cazador de ventas, Cobros, Reportes y más</p>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-brand-400 mt-0.5">&#x2713;</span>
                <p className="text-sm text-slate-400">15 plantillas por giro de negocio listas para usar</p>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-brand-400 mt-0.5">&#x2713;</span>
                <p className="text-sm text-slate-400">Kit de Agencia, cursos y comunidad incluidos</p>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-brand-400 mt-0.5">&#x2713;</span>
                <p className="text-sm text-slate-400">Multi-canal: WhatsApp, Telegram, Web y voz</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
