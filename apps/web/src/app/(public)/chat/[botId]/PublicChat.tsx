'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Bot, User, Loader2, MessageCircle, ImagePlus, X } from 'lucide-react';

const MAX_IMAGES = 4;
const isValidImageUrl = (url: string) => /^https?:\/\//i.test(url.trim());

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000/api').replace(/\/api\/?$/, '');

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: Date;
  images?: string[];
}

interface BotInfo {
  id: string;
  name: string;
  businessName: string;
  status: string;
}

interface ChatAction {
  type: 'createBooking' | 'showCatalog' | 'checkAvailability' | 'escalateToHuman';
  payload?: Record<string, unknown>;
}

interface ChatResponse {
  text: string;
  intent: string;
  actions: ChatAction[];
  conversationId: string;
}

export function PublicChat({ botId }: { botId: string }) {
  const [botInfo, setBotInfo] = useState<BotInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [showImageInput, setShowImageInput] = useState(false);
  const [imageUrlDraft, setImageUrlDraft] = useState('');
  const [imageError, setImageError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const addImage = useCallback(() => {
    const url = imageUrlDraft.trim();
    if (!url) return;
    if (!isValidImageUrl(url)) {
      setImageError('La URL debe empezar con http:// o https://');
      return;
    }
    if (images.length >= MAX_IMAGES) {
      setImageError(`Podés adjuntar hasta ${MAX_IMAGES} imágenes`);
      return;
    }
    setImages((prev) => [...prev, url]);
    setImageUrlDraft('');
    setImageError(null);
  }, [imageUrlDraft, images]);

  const removeImage = useCallback((url: string) => {
    setImages((prev) => prev.filter((u) => u !== url));
  }, []);

  useEffect(() => {
    async function loadBot() {
      try {
        const res = await fetch(`${API_BASE}/api/public/bot/${botId}`);
        if (!res.ok) { setNotFound(true); return; }
        const data = await res.json();
        setBotInfo(data);
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    }
    loadBot();
  }, [botId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(async (text?: string) => {
    const msg = (text || input).trim();
    // Cuando llega texto por parámetro (sugerencias) no adjuntamos imágenes.
    const attachedImages = text ? [] : images;
    if ((!msg && attachedImages.length === 0) || sending) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: msg,
      timestamp: new Date(),
      ...(attachedImages.length > 0 && { images: attachedImages }),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    if (attachedImages.length > 0) {
      setImages([]);
      setImageUrlDraft('');
      setShowImageInput(false);
      setImageError(null);
    }
    setSending(true);

    try {
      const res = await fetch(`${API_BASE}/api/public/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          botId,
          ...(conversationId && { conversationId }),
          ...(attachedImages.length > 0 && { imageUrls: attachedImages }),
        }),
      });
      const data: ChatResponse = await res.json();
      if (data.conversationId) setConversationId(data.conversationId);
      setMessages((prev) => [
        ...prev,
        {
          id: `bot-${Date.now()}`,
          role: 'assistant',
          text: data.text,
          timestamp: new Date(),
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          text: 'No pude conectarme con el bot. Intentá de nuevo.',
          timestamp: new Date(),
        },
      ]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [input, sending, conversationId, botId, images]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0F14] flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-sky-400 animate-spin" />
      </div>
    );
  }

  if (notFound || !botInfo) {
    return (
      <div className="min-h-screen bg-[#0B0F14] flex flex-col items-center justify-center gap-4 px-4">
        <div className="h-16 w-16 rounded-full bg-slate-800 flex items-center justify-center">
          <MessageCircle className="h-8 w-8 text-slate-600" />
        </div>
        <h1 className="text-xl font-semibold text-white">Bot no encontrado</h1>
        <p className="text-sm text-slate-400 text-center max-w-md">
          El bot que buscás no existe o no está disponible. Verificá el enlace e intentá de nuevo.
        </p>
      </div>
    );
  }

  const suggestions = ['Hola', '¿Qué servicios tienen?', 'Quiero reservar un turno', '¿Cuáles son los precios?'];

  return (
    <div className="min-h-screen bg-[#0B0F14] flex flex-col">
      <header className="border-b border-slate-800 px-4 py-3 flex items-center gap-3 shrink-0">
        <div className="h-10 w-10 rounded-full bg-sky-500/20 flex items-center justify-center">
          <Bot className="h-5 w-5 text-sky-400" />
        </div>
        <div className="min-w-0">
          <h1 className="text-sm font-semibold text-white truncate">{botInfo.name}</h1>
          <p className="text-[11px] text-slate-500 truncate">{botInfo.businessName}</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-400"></span>
          <span className="text-[10px] text-emerald-400 font-medium">En línea</span>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <div className="h-16 w-16 rounded-full bg-sky-500/10 flex items-center justify-center">
              <Bot className="h-8 w-8 text-sky-400/60" />
            </div>
            <div className="text-center">
              <p className="text-sm text-slate-400">¡Hola! Soy el asistente de <span className="text-white font-medium">{botInfo.businessName}</span>.</p>
              <p className="text-xs text-slate-500 mt-1">Preguntame lo que necesites</p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center max-w-sm mt-2">
              {suggestions.map((q) => (
                <button
                  key={q}
                  onClick={() => sendMessage(q)}
                  className="text-xs px-3 py-1.5 rounded-full border border-slate-700 text-slate-400 hover:text-white hover:border-sky-500/50 hover:bg-sky-500/10 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="h-7 w-7 rounded-full bg-sky-500/20 flex items-center justify-center shrink-0 mt-1">
                <Bot className="h-3.5 w-3.5 text-sky-400" />
              </div>
            )}
            <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
              msg.role === 'user'
                ? 'bg-sky-500 text-white rounded-br-md'
                : 'bg-[#1E2836] text-slate-200 rounded-bl-md'
            }`}>
              {msg.images && msg.images.length > 0 && (
                <div className={`flex flex-wrap gap-1.5 ${msg.text ? 'mb-2' : ''}`}>
                  {msg.images.map((url) => (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt="Imagen adjunta"
                        className="h-24 w-24 rounded-lg object-cover border border-white/10"
                      />
                    </a>
                  ))}
                </div>
              )}
              {msg.text && <p className="whitespace-pre-wrap">{msg.text}</p>}
              <p className={`text-[9px] mt-1 ${msg.role === 'user' ? 'text-white/50' : 'text-slate-500'}`}>
                {msg.timestamp.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
            {msg.role === 'user' && (
              <div className="h-7 w-7 rounded-full bg-slate-700 flex items-center justify-center shrink-0 mt-1">
                <User className="h-3.5 w-3.5 text-slate-400" />
              </div>
            )}
          </div>
        ))}

        {sending && (
          <div className="flex gap-2 items-start">
            <div className="h-7 w-7 rounded-full bg-sky-500/20 flex items-center justify-center shrink-0">
              <Bot className="h-3.5 w-3.5 text-sky-400" />
            </div>
            <div className="bg-[#1E2836] rounded-2xl rounded-bl-md px-3.5 py-2.5">
              <div className="flex gap-1">
                <span className="h-2 w-2 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: '0ms' }}></span>
                <span className="h-2 w-2 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: '150ms' }}></span>
                <span className="h-2 w-2 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: '300ms' }}></span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-slate-800 px-3 py-3 shrink-0">
        <div className="max-w-2xl mx-auto space-y-2">
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {images.map((url) => (
                <div key={url} className="relative group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt="Miniatura de imagen adjunta"
                    className="h-16 w-16 rounded-lg object-cover border border-slate-700"
                  />
                  <button
                    type="button"
                    onClick={() => removeImage(url)}
                    aria-label="Quitar imagen adjunta"
                    className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-slate-900 border border-slate-600 text-slate-300 flex items-center justify-center hover:bg-red-500 hover:text-white hover:border-red-500 transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {showImageInput && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <input
                  type="url"
                  value={imageUrlDraft}
                  onChange={(e) => { setImageUrlDraft(e.target.value); setImageError(null); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); addImage(); }
                  }}
                  placeholder="Pegá una URL de imagen (http/https)"
                  aria-label="URL de imagen a adjuntar"
                  className="flex-1 bg-[#141B24] border border-slate-700 rounded-xl px-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50 focus:ring-1 focus:ring-sky-500/25 transition-colors"
                />
                <button
                  type="button"
                  onClick={addImage}
                  disabled={!imageUrlDraft.trim() || images.length >= MAX_IMAGES}
                  className="text-xs px-3 py-2 rounded-xl border border-slate-700 text-slate-300 hover:text-white hover:border-sky-500/50 hover:bg-sky-500/10 disabled:opacity-40 transition-colors shrink-0"
                >
                  Agregar
                </button>
              </div>
              {imageError && <p className="text-[11px] text-red-400">{imageError}</p>}
              <p className="text-[10px] text-slate-500">Hasta {MAX_IMAGES} imágenes por mensaje.</p>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { setShowImageInput((v) => !v); setImageError(null); }}
              disabled={sending || images.length >= MAX_IMAGES}
              aria-label="Adjuntar imagen por URL"
              aria-expanded={showImageInput}
              title="Adjuntar imagen (URL)"
              className={`h-10 w-10 rounded-xl border flex items-center justify-center transition-colors shrink-0 disabled:opacity-40 ${
                showImageInput
                  ? 'border-sky-500/50 bg-sky-500/10 text-sky-400'
                  : 'border-slate-700 text-slate-400 hover:text-white hover:border-sky-500/50 hover:bg-sky-500/10'
              }`}
            >
              <ImagePlus className="h-4 w-4" />
            </button>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Escribí un mensaje..."
              className="flex-1 bg-[#141B24] border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50 focus:ring-1 focus:ring-sky-500/25 transition-colors"
              disabled={sending}
            />
            <button
              onClick={() => sendMessage()}
              disabled={(!input.trim() && images.length === 0) || sending}
              aria-label="Enviar mensaje"
              className="h-10 w-10 rounded-xl bg-sky-500 text-white flex items-center justify-center hover:bg-sky-600 disabled:opacity-40 disabled:hover:bg-sky-500 transition-colors shrink-0"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
        <p className="text-center text-[9px] text-slate-600 mt-2">
          Powered by Local B
        </p>
      </div>
    </div>
  );
}
