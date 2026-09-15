'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, Bot, Save, Play, Pause, Trash2, MessageSquare,
  Settings, Key, Globe, Send, Clock, AlertTriangle, Hash,
} from 'lucide-react';
import Link from 'next/link';
import * as botsApi from '@/lib/api/bots';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';

const CHANNEL_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  TELEGRAM: { label: 'Telegram', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20', icon: '✈️' },
  WHATSAPP: { label: 'WhatsApp', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', icon: '💬' },
  WEBCHAT: { label: 'Web Chat', color: 'bg-purple-500/10 text-purple-400 border-purple-500/20', icon: '🌐' },
  INSTAGRAM: { label: 'Instagram', color: 'bg-pink-500/10 text-pink-400 border-pink-500/20', icon: '📸' },
};

const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  ACTIVE: { label: 'Activo', color: 'text-emerald-400', dot: 'bg-emerald-400' },
  PAUSED: { label: 'Pausado', color: 'text-yellow-400', dot: 'bg-yellow-400' },
  DRAFT: { label: 'Borrador', color: 'text-slate-400', dot: 'bg-slate-400' },
  ERROR: { label: 'Error', color: 'text-red-400', dot: 'bg-red-400' },
};

interface Conversation {
  id: string;
  status: string;
  channel: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  createdAt: string;
  updatedAt: string;
  _count: { messages: number };
}

interface BotDetail extends botsApi.Bot {
  conversations: Conversation[];
}

export default function BotDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [bot, setBot] = useState<BotDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState<'general' | 'config' | 'conversations'>('general');

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [channel, setChannel] = useState<botsApi.Bot['channel']>('TELEGRAM');
  const [token, setToken] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');

  const fetchBot = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await botsApi.getById(id) as BotDetail;
      setBot(data);
      setName(data.name);
      setDescription(data.description || '');
      setChannel(data.channel);
      setToken(data.token || '');
      setWebhookUrl(data.webhookUrl || '');
      setSystemPrompt((data.config?.systemPrompt as string) || '');
    } catch {
      setError('No se pudo cargar el bot');
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchBot(); }, [fetchBot]);

  async function handleSave() {
    setSaving(true);
    try {
      const config = { ...(bot?.config || {}), systemPrompt };
      await botsApi.update(id, { name, description, channel, token: token || null, webhookUrl: webhookUrl || null, config });
      await fetchBot();
    } catch {
      setError('Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleStatus() {
    if (!bot) return;
    const newStatus = bot.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    try {
      await botsApi.update(id, { status: newStatus });
      await fetchBot();
    } catch {
      setError('Error al cambiar estado');
    }
  }

  async function handleDelete() {
    if (!confirm('¿Eliminar este bot? Esta acción no se puede deshacer.')) return;
    setDeleting(true);
    try {
      await botsApi.remove(id);
      router.push('/dashboard');
    } catch {
      setError('Error al eliminar');
      setDeleting(false);
    }
  }

  if (isLoading) return <LoadingSpinner label="Cargando bot..." />;
  if (!bot) return <ErrorAlert message={error || 'Bot no encontrado'} onRetry={fetchBot} />;

  const statusInfo = STATUS_CONFIG[bot.status] || STATUS_CONFIG.DRAFT;
  const channelInfo = CHANNEL_LABELS[bot.channel] || CHANNEL_LABELS.TELEGRAM;
  const hasChanges = name !== bot.name || description !== (bot.description || '') ||
    channel !== bot.channel || token !== (bot.token || '') ||
    webhookUrl !== (bot.webhookUrl || '') || systemPrompt !== (bot.config?.systemPrompt || '');

  return (
    <div className="space-y-4">
      {error && <ErrorAlert message={error} onRetry={() => setError('')} />}

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="p-1.5 rounded-lg hover:bg-slate-700/50 text-slate-400 hover:text-white transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="h-10 w-10 rounded-xl bg-brand-400/15 flex items-center justify-center">
            <Bot className="h-5 w-5 text-brand-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">{bot.name}</h1>
            <div className="flex items-center gap-2 text-xs">
              <span className={`inline-flex items-center gap-1 ${statusInfo.color}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${statusInfo.dot}`} />
                {statusInfo.label}
              </span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] border ${channelInfo.color}`}>
                {channelInfo.label}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleToggleStatus}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              bot.status === 'ACTIVE'
                ? 'bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20'
                : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
            }`}>
            {bot.status === 'ACTIVE' ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {bot.status === 'ACTIVE' ? 'Pausar' : 'Activar'}
          </button>
          <button onClick={handleDelete} disabled={deleting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50">
            <Trash2 className="h-3.5 w-3.5" />
            Eliminar
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { icon: MessageSquare, label: 'Conversaciones', value: bot._count?.conversations || 0 },
          { icon: Hash, label: 'Mensajes', value: bot.messageCount },
          { icon: Clock, label: 'Última actividad', value: bot.lastActiveAt ? new Date(bot.lastActiveAt).toLocaleDateString('es') : '—' },
          { icon: Clock, label: 'Creado', value: new Date(bot.createdAt).toLocaleDateString('es') },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-3">
            <div className="flex items-center gap-2 text-slate-500 mb-1">
              <stat.icon className="h-3.5 w-3.5" />
              <span className="text-[10px] uppercase tracking-wider">{stat.label}</span>
            </div>
            <p className="text-sm font-semibold text-white">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-700/50 pb-px overflow-x-auto">
        {([
          { key: 'general' as const, label: 'General', icon: Settings },
          { key: 'config' as const, label: 'Configuración', icon: Key },
          { key: 'conversations' as const, label: 'Conversaciones', icon: MessageSquare },
        ]).map((tab) => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg transition-colors ${
              activeTab === tab.key
                ? 'text-brand-400 border-b-2 border-brand-400 bg-brand-400/5'
                : 'text-slate-400 hover:text-white'
            }`}>
            <tab.icon className="h-3.5 w-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'general' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-4 space-y-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Nombre del bot</label>
              <input value={name} onChange={(e) => setName(e.target.value)}
                className="w-full bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-brand-400 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Descripción</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
                className="w-full bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-brand-400 focus:outline-none resize-none" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Canal</label>
              <select value={channel} onChange={(e) => setChannel(e.target.value as botsApi.Bot['channel'])}
                className="w-full bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-brand-400 focus:outline-none">
                <option value="TELEGRAM">Telegram</option>
                <option value="WHATSAPP">WhatsApp</option>
                <option value="WEBCHAT">Web Chat</option>
                <option value="INSTAGRAM">Instagram</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">System Prompt</label>
              <p className="text-[10px] text-slate-500 mb-1">Define la personalidad y comportamiento del bot. Usa variables como {'{nombre}'}, {'{negocio}'}, {'{servicio}'}.</p>
              <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={6}
                placeholder="Eres un asistente virtual de {negocio}. Ayudas a los clientes a reservar citas, consultar servicios y resolver dudas."
                className="w-full bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-brand-400 focus:outline-none resize-none font-mono text-xs leading-relaxed" />
            </div>
          </div>
          {hasChanges && (
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors disabled:opacity-50">
              <Save className="h-4 w-4" />
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </button>
          )}
        </div>
      )}

      {activeTab === 'config' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-4 space-y-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Token de acceso</label>
              <p className="text-[10px] text-slate-500 mb-1">
                {channel === 'TELEGRAM' ? 'Token de BotFather (@BotFather en Telegram)' : 'Token de autenticación del canal'}
              </p>
              <div className="relative">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                <input value={token} onChange={(e) => setToken(e.target.value)} type="password"
                  placeholder="Pega tu token aquí..."
                  className="w-full bg-slate-900/50 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:border-brand-400 focus:outline-none font-mono" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Webhook URL</label>
              <p className="text-[10px] text-slate-500 mb-1">URL donde el bot recibirá los mensajes entrantes</p>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                <input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder="https://tu-dominio.com/api/webhook/telegram"
                  className="w-full bg-slate-900/50 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:border-brand-400 focus:outline-none font-mono text-xs" />
              </div>
            </div>
          </div>

          {bot.status === 'ERROR' && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-medium text-red-400">Bot en estado de error</h3>
                <p className="text-xs text-slate-400 mt-1">Verifica que el token y la webhook URL sean correctos. Luego activa el bot desde el botón superior.</p>
              </div>
            </div>
          )}

          {hasChanges && (
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors disabled:opacity-50">
              <Save className="h-4 w-4" />
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </button>
          )}
        </div>
      )}

      {activeTab === 'conversations' && (
        <div className="space-y-3">
          {bot.conversations.length === 0 ? (
            <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-8 text-center">
              <MessageSquare className="h-8 w-8 text-slate-600 mx-auto mb-2" />
              <p className="text-sm text-slate-400">No hay conversaciones aún</p>
              <p className="text-xs text-slate-500 mt-1">Las conversaciones aparecerán cuando los usuarios interactúen con el bot</p>
            </div>
          ) : (
            bot.conversations.map((conv) => {
              const statusColors: Record<string, string> = {
                OPEN: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
                CLOSED: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
                HANDOFF: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
              };
              return (
                <Link key={conv.id} href={`/conversaciones?id=${conv.id}`}
                  className="block rounded-xl border border-slate-700/50 bg-slate-800/30 p-3 hover:border-slate-600 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-full bg-slate-700/50 flex items-center justify-center">
                        <MessageSquare className="h-4 w-4 text-slate-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">
                          {conv.contactName || conv.contactPhone || conv.contactEmail || 'Usuario anónimo'}
                        </p>
                        <p className="text-[10px] text-slate-500">
                          {conv._count.messages} mensaje{conv._count.messages !== 1 ? 's' : ''} · {new Date(conv.updatedAt).toLocaleDateString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] border ${statusColors[conv.status] || statusColors.OPEN}`}>
                      {conv.status === 'OPEN' ? 'Abierta' : conv.status === 'CLOSED' ? 'Cerrada' : 'Handoff'}
                    </span>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
