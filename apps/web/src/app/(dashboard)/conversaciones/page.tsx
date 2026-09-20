'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  MessageSquare, Clock, X, ChevronRight, User, Filter, Search,
  Send, Loader2, AlertTriangle, Bot, Phone, Mail, Wifi, WifiOff,
  Tag, StickyNote, UserPlus, Plus, Info, Check,
} from 'lucide-react';
import { useConversations, useConversationDetail } from '@/hooks/use-conversations';
import { useSocket, useSocketEvent } from '@/hooks/use-socket';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/components/common/Toast';
import * as conversationsApi from '@/lib/api/conversations';
import * as teamApi from '@/lib/api/team';
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

// Canales disponibles para filtrar. Las llamadas por voz se persisten como
// WEBCHAT en el schema, por eso el canal "Voz" no tiene enum propio.
const CHANNEL_FILTERS: { value: string; label: string }[] = [
  { value: 'TELEGRAM', label: 'Telegram' },
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'WEBCHAT', label: 'Web' },
  { value: 'INSTAGRAM', label: 'Instagram' },
];

interface TeamOption {
  id: string;
  name: string;
}

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

// Una conversación está "no leída" si su último mensaje es del cliente (USER)
// y llegó después de la última vez que el equipo la abrió (metadata.lastReadAt).
function isUnread(conv: conversationsApi.Conversation): boolean {
  const last = conv.messages?.[0];
  if (!last || last.role !== 'USER') return false;
  const lastReadAt = conv.metadata?.lastReadAt;
  if (!lastReadAt) return true;
  return new Date(last.createdAt).getTime() > new Date(lastReadAt).getTime();
}

export default function ConversacionesPage() {
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [channelFilter, setChannelFilter] = useState<string>('');
  const [tagFilter, setTagFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const listParams = useMemo(() => {
    const p: { status?: string; channel?: string } = {};
    if (statusFilter) p.status = statusFilter;
    if (channelFilter) p.channel = channelFilter;
    return Object.keys(p).length ? p : undefined;
  }, [statusFilter, channelFilter]);
  const { conversations, total, isLoading, error, refetch, closeConversation } = useConversations(listParams);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { detail, isLoading: detailLoading, refetchDetail } = useConversationDetail(selectedId);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [team, setTeam] = useState<TeamOption[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [savingTag, setSavingTag] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { business } = useAuth();
  const { toast } = useToast();
  const { connected } = useSocket(business?.id ?? null);

  useEffect(() => {
    let cancelled = false;
    teamApi.getMembers()
      .then((members) => {
        if (!cancelled) setTeam(members.map((m) => ({ id: m.id, name: m.name })));
      })
      .catch(() => { /* el equipo es opcional para asignar */ });
    return () => { cancelled = true; };
  }, []);

  useSocketEvent<{ conversationId: string }>('conversation:new-message', (data) => {
    if (data.conversationId === selectedId) {
      refetchDetail();
    }
    refetch();
  }, [selectedId]);

  useSocketEvent<{ conversationId: string }>('conversation:closed', () => {
    refetch();
  });

  useSocketEvent<{ conversationId: string }>('conversation:updated', (data) => {
    if (data.conversationId === selectedId) {
      refetchDetail();
    }
    refetch();
  }, [selectedId]);

  // Etiquetas únicas presentes en las conversaciones cargadas (para el filtro).
  const allTags = useMemo(() => {
    const set = new Set<string>();
    conversations.forEach((c) => c.metadata?.tags?.forEach((t) => set.add(t)));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [conversations]);

  const filtered = useMemo(() => {
    let list = conversations;
    if (tagFilter) {
      list = list.filter((c) => c.metadata?.tags?.includes(tagFilter));
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter((c) => (
        c.contactName?.toLowerCase().includes(q) ||
        c.contactPhone?.toLowerCase().includes(q) ||
        c.messages?.[0]?.text.toLowerCase().includes(q) ||
        c.metadata?.tags?.some((t) => t.toLowerCase().includes(q))
      ));
    }
    return list;
  }, [conversations, tagFilter, searchQuery]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [detail?.messages?.length]);

  useEffect(() => {
    if (selectedId && detail) {
      inputRef.current?.focus();
    }
  }, [selectedId, detail]);

  const handleSelect = useCallback(async (id: string) => {
    setSelectedId(id);
    try {
      await conversationsApi.markRead(id);
      refetch();
    } catch { /* marcar leído no es crítico */ }
  }, [refetch]);

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
      toast({ type: 'error', message: 'No se pudo enviar la respuesta.' });
    } finally {
      setSending(false);
    }
  }

  async function handleClose(id: string) {
    await closeConversation(id);
    if (selectedId === id) setSelectedId(null);
  }

  async function handleAssign(memberId: string) {
    if (!selectedId) return;
    try {
      await conversationsApi.assign(selectedId, memberId || null);
      refetchDetail();
      refetch();
      toast({ type: 'success', message: memberId ? 'Conversación asignada.' : 'Asignación quitada.' });
    } catch {
      toast({ type: 'error', message: 'No se pudo asignar la conversación.' });
    }
  }

  async function handleAddTag() {
    const tag = tagInput.trim();
    if (!tag || !selectedId || savingTag) return;
    const current = detail?.metadata?.tags ?? [];
    if (current.some((t) => t.toLowerCase() === tag.toLowerCase())) {
      setTagInput('');
      return;
    }
    setSavingTag(true);
    try {
      await conversationsApi.setTags(selectedId, [...current, tag]);
      setTagInput('');
      refetchDetail();
      refetch();
    } catch {
      toast({ type: 'error', message: 'No se pudo agregar la etiqueta.' });
    } finally {
      setSavingTag(false);
    }
  }

  async function handleRemoveTag(tag: string) {
    if (!selectedId) return;
    const current = detail?.metadata?.tags ?? [];
    try {
      await conversationsApi.setTags(selectedId, current.filter((t) => t !== tag));
      refetchDetail();
      refetch();
    } catch {
      toast({ type: 'error', message: 'No se pudo quitar la etiqueta.' });
    }
  }

  async function handleAddNote() {
    const text = noteInput.trim();
    if (!text || !selectedId || savingNote) return;
    setSavingNote(true);
    try {
      await conversationsApi.addNote(selectedId, text);
      setNoteInput('');
      refetchDetail();
      toast({ type: 'success', message: 'Nota agregada.' });
    } catch {
      toast({ type: 'error', message: 'No se pudo agregar la nota.' });
    } finally {
      setSavingNote(false);
    }
  }

  if (isLoading) return <LoadingSpinner label="Cargando conversaciones..." />;

  const openCount = conversations.filter((c) => c.status === 'OPEN').length;
  const handoffCount = conversations.filter((c) => c.status === 'HANDOFF').length;
  const unreadCount = conversations.filter(isUnread).length;

  // Contadores por canal sobre las conversaciones cargadas.
  const channelCounts = conversations.reduce<Record<string, number>>((acc, c) => {
    acc[c.channel] = (acc[c.channel] ?? 0) + 1;
    return acc;
  }, {});

  const notes = detail?.metadata?.notes ?? [];
  const detailTags = detail?.metadata?.tags ?? [];

  return (
    <div className="space-y-4">
      {error && <ErrorAlert message={error} onRetry={refetch} />}

      {/* Header with stats */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            Inbox
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
          <div className="flex items-center gap-3 mt-1 text-xs text-slate-500 flex-wrap">
            <span>{total} total</span>
            {unreadCount > 0 && (
              <span className="flex items-center gap-1 text-brand-400">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-400" />
                {unreadCount} sin leer
              </span>
            )}
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
      <div className="space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex gap-1.5 flex-wrap">
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
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por nombre, teléfono, mensaje o etiqueta..."
              className="w-full rounded-lg border border-slate-700 bg-surface px-3 py-1.5 pl-9 text-sm text-white placeholder:text-slate-600 focus:border-brand-400/50 focus:outline-none"
            />
          </div>
        </div>

        {/* Channel filter */}
        <div className="flex gap-1.5 flex-wrap items-center">
          <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-600">
            <Filter className="h-3 w-3" /> Canal
          </span>
          <button
            onClick={() => setChannelFilter('')}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
              channelFilter === ''
                ? 'bg-brand-400/10 text-brand-400 border-brand-400/30'
                : 'text-slate-400 border-slate-700 hover:text-white hover:border-slate-600'
            }`}
          >
            Todos
          </button>
          {CHANNEL_FILTERS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setChannelFilter(opt.value)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1.5 ${
                channelFilter === opt.value
                  ? 'bg-brand-400/10 text-brand-400 border-brand-400/30'
                  : 'text-slate-400 border-slate-700 hover:text-white hover:border-slate-600'
              }`}
            >
              {opt.label}
              {channelCounts[opt.value] ? (
                <span className="text-[9px] text-slate-500">{channelCounts[opt.value]}</span>
              ) : null}
            </button>
          ))}
        </div>

        {/* Tag filter */}
        {allTags.length > 0 && (
          <div className="flex gap-1.5 flex-wrap items-center">
            <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-600">
              <Tag className="h-3 w-3" /> Etiquetas
            </span>
            <button
              onClick={() => setTagFilter('')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                tagFilter === ''
                  ? 'bg-brand-400/10 text-brand-400 border-brand-400/30'
                  : 'text-slate-400 border-slate-700 hover:text-white hover:border-slate-600'
              }`}
            >
              Todas
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setTagFilter(tag)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                  tagFilter === tag
                    ? 'bg-brand-400/10 text-brand-400 border-brand-400/30'
                    : 'text-slate-400 border-slate-700 hover:text-white hover:border-slate-600'
                }`}
              >
                #{tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Split pane */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" style={{ minHeight: '28rem' }}>
        {/* Conversation list */}
        <div className="lg:col-span-1 space-y-1.5 overflow-y-auto pr-1" style={{ maxHeight: '34rem' }}>
          {filtered.length === 0 && (
            <div className="text-center py-12">
              <MessageSquare className="h-10 w-10 text-slate-700 mx-auto mb-3" />
              <p className="text-sm text-slate-500">
                {searchQuery || tagFilter ? 'Sin resultados para el filtro.' : 'No hay conversaciones todavía.'}
              </p>
            </div>
          )}
          {filtered.map((conv) => {
            const status = STATUS_COLORS[conv.status] || STATUS_COLORS.OPEN;
            const lastMsg = conv.messages?.[0];
            const isSelected = selectedId === conv.id;
            const unread = isUnread(conv);
            const assignedName = conv.metadata?.assignedToName;
            const tags = conv.metadata?.tags ?? [];
            return (
              <button
                key={conv.id}
                onClick={() => handleSelect(conv.id)}
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
                    <p className={`text-sm truncate flex items-center gap-1.5 ${unread ? 'font-semibold text-white' : 'font-medium text-white'}`}>
                      {unread && <span className="w-2 h-2 rounded-full bg-brand-400 shrink-0" />}
                      {conv.contactName || 'Anónimo'}
                    </p>
                    <span className="text-[10px] text-slate-600 shrink-0">{timeAgo(conv.updatedAt)}</span>
                  </div>
                  {lastMsg && (
                    <p className={`text-xs truncate mt-0.5 ${unread ? 'text-slate-300' : 'text-slate-500'}`}>
                      {lastMsg.role === 'BOT' ? 'Bot: ' : ''}{lastMsg.text}
                    </p>
                  )}
                  {tags.length > 0 && (
                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                      {tags.slice(0, 3).map((t) => (
                        <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-brand-400/10 text-brand-400 border border-brand-400/20">
                          #{t}
                        </span>
                      ))}
                      {tags.length > 3 && <span className="text-[9px] text-slate-600">+{tags.length - 3}</span>}
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-600 flex-wrap">
                    <span>{CHANNEL_LABELS[conv.channel] || conv.channel}</span>
                    <span>·</span>
                    <span>{conv._count?.messages ?? 0} msgs</span>
                    {assignedName && (
                      <>
                        <span>·</span>
                        <span className="flex items-center gap-0.5 text-slate-400">
                          <User className="h-2.5 w-2.5" /> {assignedName}
                        </span>
                      </>
                    )}
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
        <div className="lg:col-span-2 rounded-xl border border-slate-700/50 bg-slate-800/30 flex overflow-hidden" style={{ minHeight: '28rem' }}>
          <div className="flex-1 flex flex-col min-w-0">
          {!selectedId && (
            <div className="flex-1 flex items-center justify-center text-center">
              <div>
                <MessageSquare className="h-12 w-12 text-slate-700 mx-auto mb-3" />
                <p className="text-sm text-slate-500">Seleccioná una conversación para ver el historial</p>
                <p className="text-xs text-slate-600 mt-1">Podés responder, asignar, etiquetar y dejar notas internas</p>
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
              <div className="flex flex-wrap items-center justify-between gap-2 p-4 border-b border-slate-700/50">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-brand-400/10 flex items-center justify-center">
                    <User className="h-5 w-5 text-brand-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">{detail.contactName || 'Cliente anónimo'}</p>
                    <div className="flex items-center gap-2 text-[10px] text-slate-500 flex-wrap">
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
                      {detail.metadata?.assignedToName && (
                        <>
                          <span>·</span>
                          <span className="flex items-center gap-0.5 text-brand-400">
                            <User className="h-2.5 w-2.5" /> {detail.metadata.assignedToName}
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
                  <button
                    onClick={() => setShowDetails((v) => !v)}
                    className={`btn-secondary text-xs py-1 ${showDetails ? 'text-brand-400' : ''}`}
                    title="Detalles, asignación, etiquetas y notas"
                  >
                    <Info className="h-3 w-3" /> Detalles
                  </button>
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

              {/* Tags chips row */}
              {detailTags.length > 0 && (
                <div className="mx-4 mt-3 flex items-center gap-1.5 flex-wrap">
                  {detailTags.map((tag) => (
                    <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-brand-400/10 text-brand-400 border border-brand-400/20 flex items-center gap-1">
                      #{tag}
                      <button onClick={() => handleRemoveTag(tag)} className="hover:text-white">
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
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

          {/* Details / side panel */}
          {selectedId && detail && showDetails && (
            <div className="hidden lg:flex w-72 shrink-0 flex-col border-l border-slate-700/50 bg-slate-900/40 overflow-y-auto">
              {/* Asignación */}
              <div className="p-4 border-b border-slate-700/50">
                <p className="text-[10px] uppercase tracking-wide text-slate-500 flex items-center gap-1.5 mb-2">
                  <UserPlus className="h-3 w-3" /> Asignado a
                </p>
                <select
                  value={detail.metadata?.assignedTo ?? ''}
                  onChange={(e) => handleAssign(e.target.value)}
                  className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-2 py-1.5 text-xs text-white focus:border-brand-400/50 focus:outline-none"
                >
                  <option value="">Sin asignar</option>
                  {team.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
                {team.length === 0 && (
                  <p className="text-[10px] text-slate-600 mt-1.5">No hay miembros del equipo cargados.</p>
                )}
              </div>

              {/* Etiquetas */}
              <div className="p-4 border-b border-slate-700/50">
                <p className="text-[10px] uppercase tracking-wide text-slate-500 flex items-center gap-1.5 mb-2">
                  <Tag className="h-3 w-3" /> Etiquetas
                </p>
                <div className="flex items-center gap-1.5 flex-wrap mb-2">
                  {detailTags.length === 0 && <span className="text-[10px] text-slate-600">Sin etiquetas.</span>}
                  {detailTags.map((tag) => (
                    <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-brand-400/10 text-brand-400 border border-brand-400/20 flex items-center gap-1">
                      #{tag}
                      <button onClick={() => handleRemoveTag(tag)} className="hover:text-white">
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
                    placeholder="Nueva etiqueta..."
                    maxLength={40}
                    className="flex-1 rounded-lg border border-slate-600 bg-slate-700/50 px-2 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-brand-400/50 focus:outline-none"
                  />
                  <button
                    onClick={handleAddTag}
                    disabled={savingTag || !tagInput.trim()}
                    className="h-7 w-7 rounded-lg bg-brand-400 hover:bg-brand-500 flex items-center justify-center text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                  >
                    {savingTag ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              {/* Notas internas */}
              <div className="p-4 flex-1">
                <p className="text-[10px] uppercase tracking-wide text-slate-500 flex items-center gap-1.5 mb-2">
                  <StickyNote className="h-3 w-3" /> Notas internas
                </p>
                <div className="space-y-2 mb-3">
                  {notes.length === 0 && <span className="text-[10px] text-slate-600">Sin notas todavía.</span>}
                  {notes.map((note, i) => (
                    <div key={i} className="rounded-lg bg-amber-500/5 border border-amber-500/15 px-2.5 py-2">
                      <p className="text-xs text-slate-200 whitespace-pre-wrap">{note.text}</p>
                      <p className="text-[9px] text-slate-500 mt-1">
                        {note.byName ? `${note.byName} · ` : ''}
                        {new Date(note.at).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  ))}
                </div>
                <textarea
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  placeholder="Escribí una nota privada del equipo..."
                  rows={3}
                  maxLength={2000}
                  className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-2 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-brand-400/50 focus:outline-none resize-none"
                />
                <button
                  onClick={handleAddNote}
                  disabled={savingNote || !noteInput.trim()}
                  className="mt-2 w-full btn-secondary text-xs py-1.5 justify-center disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {savingNote ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Agregar nota
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
