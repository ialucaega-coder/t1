'use client';

import { useState } from 'react';
import { MessageSquare, Bot, Clock, X, ChevronRight, User, Filter } from 'lucide-react';
import { useConversations, useConversationDetail } from '@/hooks/use-conversations';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';

const STATUS_COLORS: Record<string, { label: string; class: string }> = {
  OPEN: { label: 'Abierta', class: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  CLOSED: { label: 'Cerrada', class: 'bg-slate-500/10 text-slate-400 border-slate-500/20' },
  HANDOFF: { label: 'Derivada', class: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' },
};

const CHANNEL_LABELS: Record<string, string> = {
  TELEGRAM: 'Telegram',
  WHATSAPP: 'WhatsApp',
  WEBCHAT: 'Web',
  INSTAGRAM: 'Instagram',
};

export default function ConversacionesPage() {
  const [statusFilter, setStatusFilter] = useState<string>('');
  const { conversations, total, isLoading, error, refetch, closeConversation } = useConversations(
    statusFilter ? { status: statusFilter } : undefined
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { detail, isLoading: detailLoading } = useConversationDetail(selectedId);

  if (isLoading) return <LoadingSpinner label="Cargando conversaciones..." />;

  return (
    <div className="space-y-6">
      {error && <ErrorAlert message={error} onRetry={refetch} />}

      <p className="text-sm text-slate-400 max-w-2xl">
        Todas las conversaciones de tus bots en un solo lugar. Revisá el historial, derivá a un humano o cerrá las resueltas.
      </p>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Filter className="h-4 w-4" />
          <span>Estado:</span>
        </div>
        <div className="flex gap-2">
          {[{ value: '', label: 'Todas' }, { value: 'OPEN', label: 'Abiertas' }, { value: 'CLOSED', label: 'Cerradas' }, { value: 'HANDOFF', label: 'Derivadas' }].map((opt) => (
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
        <span className="text-xs text-slate-500 ml-auto">{total} conversaciones</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" style={{ minHeight: '24rem' }}>
        <div className="lg:col-span-1 space-y-2 overflow-y-auto" style={{ maxHeight: '36rem' }}>
          {conversations.length === 0 && (
            <div className="text-center py-12">
              <MessageSquare className="h-10 w-10 text-slate-700 mx-auto mb-3" />
              <p className="text-sm text-slate-500">No hay conversaciones todavía.</p>
              <p className="text-xs text-slate-600 mt-1">Cuando los clientes escriban al bot, sus chats aparecen acá.</p>
            </div>
          )}
          {conversations.map((conv) => {
            const status = STATUS_COLORS[conv.status] || STATUS_COLORS.OPEN;
            const lastMsg = conv.messages?.[0];
            return (
              <button
                key={conv.id}
                onClick={() => setSelectedId(conv.id)}
                className={`w-full card text-left flex items-start gap-3 transition-colors ${
                  selectedId === conv.id ? 'border-brand-400/50 bg-brand-400/5' : ''
                }`}
              >
                <div className="h-9 w-9 rounded-full bg-brand-400/10 flex items-center justify-center shrink-0 mt-0.5">
                  <User className="h-4 w-4 text-brand-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-white truncate">{conv.contactName || 'Cliente anónimo'}</p>
                    <span className={`badge border text-[8px] ${status.class}`}>{status.label}</span>
                  </div>
                  {lastMsg && (
                    <p className="text-xs text-slate-500 truncate mt-0.5">
                      {lastMsg.role === 'BOT' ? 'Bot: ' : ''}{lastMsg.text}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-600">
                    <span>{CHANNEL_LABELS[conv.channel] || conv.channel}</span>
                    <span>·</span>
                    <span className="flex items-center gap-0.5">
                      <MessageSquare className="h-2.5 w-2.5" /> {conv._count?.messages ?? 0}
                    </span>
                    <span>·</span>
                    <span className="flex items-center gap-0.5">
                      <Clock className="h-2.5 w-2.5" />
                      {new Date(conv.updatedAt).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}
                    </span>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-600 shrink-0 mt-2" />
              </button>
            );
          })}
        </div>

        <div className="lg:col-span-2 card flex flex-col" style={{ minHeight: '24rem' }}>
          {!selectedId && (
            <div className="flex-1 flex items-center justify-center text-center">
              <div>
                <MessageSquare className="h-12 w-12 text-slate-700 mx-auto mb-3" />
                <p className="text-sm text-slate-500">Seleccioná una conversación para ver el historial</p>
              </div>
            </div>
          )}

          {selectedId && detailLoading && <LoadingSpinner label="Cargando mensajes..." />}

          {selectedId && detail && (
            <>
              <div className="flex items-center justify-between pb-3 border-b border-slate-700/50 mb-3">
                <div className="flex items-center gap-2">
                  <User className="h-5 w-5 text-brand-400" />
                  <div>
                    <p className="text-sm font-semibold text-white">{detail.contactName || 'Cliente anónimo'}</p>
                    <p className="text-[10px] text-slate-500">
                      {detail.bot?.name} · {CHANNEL_LABELS[detail.channel] || detail.channel} · {detail.messages.length} mensajes
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {detail.status === 'OPEN' && (
                    <button onClick={() => closeConversation(detail.id)} className="btn-secondary text-xs py-1">
                      <X className="h-3 w-3" /> Cerrar
                    </button>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 pr-1" style={{ maxHeight: '22rem' }}>
                {detail.messages.map((msg) => (
                  <div key={msg.id} className={`flex ${msg.role === 'USER' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                      msg.role === 'USER'
                        ? 'bg-brand-400 text-white rounded-br-md'
                        : 'bg-surface-100 text-slate-300 rounded-bl-md'
                    }`}>
                      <p className="whitespace-pre-wrap">{msg.text}</p>
                      <p className={`text-[9px] mt-1 ${msg.role === 'USER' ? 'text-white/60' : 'text-slate-500'}`}>
                        {new Date(msg.createdAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                        {msg.responseTime != null && msg.role === 'BOT' ? ` · ${msg.responseTime}ms` : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
