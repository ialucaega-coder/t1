'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  MessageSquare, Clock, X, ChevronRight, User, Filter, Search,
  Send, Loader2, AlertTriangle, Bot, Phone, Mail, Wifi, WifiOff,
} from 'lucide-react';
import { useConversations, useConversationDetail } from '@/hooks/use-conversations';
import { useSocket, useSocketEvent } from '@/hooks/use-socket';
import { useAuth } from '@/lib/auth-context';
import * as conversationsApi from '@/lib/api/conversations';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';

const STATUS_COLORS: Record<string, { label: string; class: string; dot: string }> = {
  OPEN: { label: 'Abierta', class: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', dot: 'bg-emerald-400' },
  CLOSED: { label: 'Cerrada', class: 'bg-slate-500/10 text-slate-400 border-slate-500/20', dot: 'bg-slate-500' },
  HANDOFF: { label: 'Derivada', class: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20', dot: 'bg-yellow-400' },
};

const CHANNEL_LABELS: Record<string, string> = {
  TELEGRAM: 'Telegram',
  WHATSAPP: 'WhatsApp',
  WEBCHAT: 'Web',
  INSTAGRAM: 'Instagram',
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return new Date(dateStr).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

export default function ConversacionesPage() {
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const { conversations, total, isLoading, error, refetch, closeConversation } = useConversations(
    statusFilter ? { status: statusFilter } : undefined
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { detail, isLoading: detailLoading, refetchDetail } = useConversationDetail(selectedId);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { business } = useAuth();
  const { connected } = useSocket(business?.id ?? null);

  useSocketEvent<{ conversationId: string }>('conversation:new-message', (data) => {
    if (data.conversationId === selectedId) {
      refetchDetail();
    }
    refetch();
  }, [selectedId]);

  useSocketEvent<{ conversationId: string }>('conversation:closed', () => {
    refetch();
  });

  const filtered = searchQuery
    ? conversations.filter((c) => {
        const q = searchQuery.toLowerCase();
        return (
          c.contactName?.toLowerCase().includes(q) ||
          c.contactPhone?.toLowerCase().includes(q) ||
          c.messages?.[0]?.text.toLowerCase().includes(q)
        );
      })
    : conversations;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [detail?.messages?.length]);

  useEffect(() => {
    if (selectedId && detail) {
      inputRef.current?.focus();
    }
  }, [selectedId, detail]);

  async function handleReply() {
    if (!replyText.trim() || !selectedId || sending) return;
    setSending(true);
    try {
      await conversationsApi.reply(selectedId, replyText.trim());
      setReplyText('');
      refetchDetail();
      refetch();
    } catch (err) {
      console.error('Error sending reply:', err);
    } finally {
      setSending(false);
    }
  }

  async function handleClose(id: string) {
    await closeConversation(id);
    if (selectedId === id) setSelectedId(null);
  }

  if (isLoading) return <LoadingSpinner label="Cargando conversaciones..." />;

  const openCount = conversations.filter((c) => c.status === 'OPEN').length;
  const handoffCount = conversations.filter((c) => c.status === 'HANDOFF').length;

  return (
    <div className="space-y-4">
      {error && <ErrorAlert message={error} onRetry={refetch} />}

      {/* Header with stats */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            Conversaciones
            {connected ? (
              <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-normal">
                <Wifi className="h-3 w-3" /> en vivo
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] text-slate-600 font-normal">
                <WifiOff className="h-3 w-3" /> offline
              </span>
            )}
          </h1>
          <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
            <span>{total} total</span>
            {openCount > 0 && (
              <span className="flex items-center gap-1 text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                {openCount} abiertas
              </span>
            )}
            {handoffCount > 0 && (
              <span className="flex items-center gap-1 text-yellow-400">
                <AlertTriangle className="h-3 w-3" />
                {handoffCount} esperando humano
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Filters + Search */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1.5">
          {[
            { value: '', label: 'Todas' },
            { value: 'OPEN', label: 'Abiertas' },
            { value: 'HANDOFF', label: 'Derivadas' },
            { value: 'CLOSED', label: 'Cerradas' },
          ].map((opt) => (
            <button
              key={opt.value}
              onClick={() => setStatusFilter(opt.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                statusFilter === opt.value
                  ? 'bg-brand-400/10 text-brand-400 border-brand-400/30'
                  : 'text-slate-400 border-slate-700 hover:text-white hover:border-slate-600'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por nombre, teléfono o mensaje..."
            className="w-full rounded-lg border border-slate-700 bg-surface px-3 py-1.5 pl-9 text-sm text-white placeholder:text-slate-600 focus:border-brand-400/50 focus:outline-none"
          />
        </div>
      </div>

      {/* Split pane */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" style={{ minHeight: '28rem' }}>
        {/* Conversation list */}
        <div className="lg:col-span-1 space-y-1.5 overflow-y-auto pr-1" style={{ maxHeight: '34rem' }}>
          {filtered.length === 0 && (
            <div className="text-center py-12">
              <MessageSquare className="h-10 w-10 text-slate-700 mx-auto mb-3" />
              <p className="text-sm text-slate-500">
                {searchQuery ? 'Sin resultados para la búsqueda.' : 'No hay conversaciones todavía.'}
              </p>
            </div>
          )}
          {filtered.map((conv) => {
            const status = STATUS_COLORS[conv.status] || STATUS_COLORS.OPEN;
            const lastMsg = conv.messages?.[0];
            const isSelected = selectedId === conv.id;
            return (
              <button
                key={conv.id}
                onClick={() => setSelectedId(conv.id)}
                className={`w-full rounded-xl border p-3 text-left flex items-start gap-3 transition-all ${
                  isSelected
                    ? 'border-brand-400/50 bg-brand-400/5'
                    : 'border-slate-700/50 bg-slate-800/30 hover:border-slate-600 hover:bg-slate-800/60'
                }`}
              >
                <div className="relative shrink-0">
                  <div className="h-9 w-9 rounded-full bg-brand-400/10 flex items-center justify-center">
                    <User className="h-4 w-4 text-brand-400" />
                  </div>
                  <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-slate-800 ${status.dot}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-white truncate">{conv.contactName || 'Anónimo'}</p>
                    <span className="text-[10px] text-slate-600 shrink-0">{timeAgo(conv.updatedAt)}</span>
                  </div>
                  {lastMsg && (
                    <p className="text-xs text-slate-500 truncate mt-0.5">
                      {lastMsg.role === 'BOT' ? 'Bot: ' : ''}{lastMsg.text}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-600">
                    <span>{CHANNEL_LABELS[conv.channel] || conv.channel}</span>
                    <span>·</span>
                    <span>{conv._count?.messages ?? 0} msgs</span>
                    {conv.status === 'HANDOFF' && (
                      <>
                        <span>·</span>
                        <span className="text-yellow-400 font-medium">Requiere atención</span>
                      </>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Chat detail */}
        <div className="lg:col-span-2 rounded-xl border border-slate-700/50 bg-slate-800/30 flex flex-col" style={{ minHeight: '28rem' }}>
          {!selectedId && (
            <div className="flex-1 flex items-center justify-center text-center">
              <div>
                <MessageSquare className="h-12 w-12 text-slate-700 mx-auto mb-3" />
                <p className="text-sm text-slate-500">Seleccioná una conversación para ver el historial</p>
                <p className="text-xs text-slate-600 mt-1">Podés responder como humano a las conversaciones activas</p>
              </div>
            </div>
          )}

          {selectedId && detailLoading && (
            <div className="flex-1 flex items-center justify-center">
              <LoadingSpinner label="Cargando mensajes..." />
            </div>
          )}

          {selectedId && detail && (
            <>
              {/* Chat header */}
              <div className="flex items-center justify-between p-4 border-b border-slate-700/50">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-brand-400/10 flex items-center justify-center">
                    <User className="h-5 w-5 text-brand-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">{detail.contactName || 'Cliente anónimo'}</p>
                    <div className="flex items-center gap-2 text-[10px] text-slate-500">
                      <span className="flex items-center gap-1">
                        <Bot className="h-2.5 w-2.5" /> {detail.bot?.name || 'Bot'}
                      </span>
                      <span>·</span>
                      <span>{CHANNEL_LABELS[detail.channel] || detail.channel}</span>
                      <span>·</span>
                      <span>{detail.messages.length} mensajes</span>
                      {detail.contactPhone && (
                        <>
                          <span>·</span>
                          <span className="flex items-center gap-0.5">
                            <Phone className="h-2.5 w-2.5" /> {detail.contactPhone}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`badge border text-[9px] ${(STATUS_COLORS[detail.status] || STATUS_COLORS.OPEN).class}`}>
                    {(STATUS_COLORS[detail.status] || STATUS_COLORS.OPEN).label}
                  </span>
                  {detail.status !== 'CLOSED' && (
                    <button onClick={() => handleClose(detail.id)} className="btn-secondary text-xs py-1">
                      <X className="h-3 w-3" /> Cerrar
                    </button>
                  )}
                </div>
              </div>

              {/* Handoff banner */}
              {detail.status === 'HANDOFF' && (
                <div className="mx-4 mt-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 px-3 py-2 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-400 shrink-0" />
                  <p className="text-xs text-yellow-300">
                    El cliente pidió hablar con un humano. Respondé abajo para tomar la conversación.
                  </p>
                </div>
              )}

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ maxHeight: '22rem' }}>
                {detail.messages.map((msg) => (
                  <div key={msg.id} className={`flex ${msg.role === 'USER' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                      msg.role === 'USER'
                        ? 'bg-brand-400 text-white rounded-br-md'
                        : 'bg-slate-700/50 text-slate-200 rounded-bl-md'
                    }`}>
                      <p className="whitespace-pre-wrap">{msg.text}</p>
                      <p className={`text-[9px] mt-1 ${msg.role === 'USER' ? 'text-white/50' : 'text-slate-500'}`}>
                        {new Date(msg.createdAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                        {msg.responseTime != null && msg.role === 'BOT' ? ` · ${msg.responseTime}ms` : ''}
                      </p>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* Reply input */}
              {detail.status !== 'CLOSED' && (
                <div className="p-3 border-t border-slate-700/50">
                  <div className="flex items-center gap-2">
                    <input
                      ref={inputRef}
                      type="text"
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleReply()}
                      placeholder="Escribí una respuesta como humano..."
                      className="flex-1 rounded-lg border border-slate-600 bg-slate-700/50 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-brand-400/50 focus:outline-none"
                      disabled={sending}
                    />
                    <button
                      onClick={handleReply}
                      disabled={sending || !replyText.trim()}
                      className="h-9 w-9 rounded-lg bg-brand-400 hover:bg-brand-500 flex items-center justify-center text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
