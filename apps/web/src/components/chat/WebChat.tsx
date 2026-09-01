'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageCircle, X, Send, Bot, User, Loader2 } from 'lucide-react';
import { httpClient } from '@/lib/api/http-client';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: Date;
}

interface ChatResponse {
  text: string;
  intent: string;
  actions: any[];
  conversationId: string;
}

export function WebChat({ botId }: { botId?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setSending(true);

    try {
      const res = await httpClient.post<ChatResponse>('/ai/chat', {
        message: text,
        channel: 'WEB',
        conversationId,
        botId,
      });
      if (res.conversationId) setConversationId(res.conversationId);
      setMessages((prev) => [
        ...prev,
        {
          id: `bot-${Date.now()}`,
          role: 'assistant',
          text: res.text,
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
    }
  }, [input, sending, conversationId, botId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full bg-brand-400 text-white shadow-lg hover:bg-brand-500 transition-all flex items-center justify-center"
      >
        <MessageCircle className="h-6 w-6" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 w-96 max-w-[calc(100vw-3rem)] rounded-2xl border border-slate-700 bg-surface shadow-2xl flex flex-col" style={{ height: '32rem' }}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-brand-400/20 flex items-center justify-center">
            <Bot className="h-4 w-4 text-brand-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Chat de prueba</p>
            <p className="text-[10px] text-slate-500">Probá tu bot en tiempo real</p>
          </div>
        </div>
        <button onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-white transition-colors">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <Bot className="h-10 w-10 text-slate-700 mx-auto mb-3" />
            <p className="text-sm text-slate-500">Escribí un mensaje para probar tu bot</p>
            <div className="flex flex-wrap gap-2 justify-center mt-3">
              {['Hola', '¿Qué servicios tenés?', 'Quiero reservar un turno'].map((q) => (
                <button
                  key={q}
                  onClick={() => { setInput(q); }}
                  className="text-xs px-3 py-1.5 rounded-full border border-slate-700 text-slate-400 hover:text-white hover:border-slate-600 transition-colors"
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
              <div className="h-6 w-6 rounded-full bg-brand-400/20 flex items-center justify-center shrink-0 mt-1">
                <Bot className="h-3 w-3 text-brand-400" />
              </div>
            )}
            <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
              msg.role === 'user'
                ? 'bg-brand-400 text-white rounded-br-md'
                : 'bg-surface-100 text-slate-300 rounded-bl-md'
            }`}>
              <p className="whitespace-pre-wrap">{msg.text}</p>
              <p className={`text-[9px] mt-1 ${msg.role === 'user' ? 'text-white/60' : 'text-slate-500'}`}>
                {msg.timestamp.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
            {msg.role === 'user' && (
              <div className="h-6 w-6 rounded-full bg-slate-700 flex items-center justify-center shrink-0 mt-1">
                <User className="h-3 w-3 text-slate-400" />
              </div>
            )}
          </div>
        ))}
        {sending && (
          <div className="flex gap-2 items-center">
            <div className="h-6 w-6 rounded-full bg-brand-400/20 flex items-center justify-center">
              <Bot className="h-3 w-3 text-brand-400" />
            </div>
            <div className="bg-surface-100 rounded-2xl rounded-bl-md px-3 py-2">
              <Loader2 className="h-4 w-4 text-slate-400 animate-spin" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="px-3 py-3 border-t border-slate-700/50">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Escribí un mensaje..."
            className="input flex-1 text-sm"
            disabled={sending}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || sending}
            className="h-9 w-9 rounded-lg bg-brand-400 text-white flex items-center justify-center hover:bg-brand-500 disabled:opacity-50 disabled:hover:bg-brand-400 transition-colors shrink-0"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
