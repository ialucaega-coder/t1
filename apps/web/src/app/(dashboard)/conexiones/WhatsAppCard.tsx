'use client';

import { useState, useEffect } from 'react';
import { MessageCircle, CheckCircle2, Copy, Send, Loader2, AlertCircle } from 'lucide-react';
import { whatsappApi } from '@/lib/api/index';
import { API_URL } from '@/lib/api/http-client';
import { useToast } from '@/components/common/Toast';

// Tarjeta de conexión de WhatsApp (vía Twilio). El canal YA está implementado en
// el backend: webhook entrante procesado por el bot + envío saliente por
// /whatsapp/send. `configured` dice si el servidor tiene credenciales de Twilio.
export function WhatsAppCard() {
  const { toast } = useToast();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [to, setTo] = useState('');
  const [message, setMessage] = useState('Hola 👋 Esto es una prueba desde Local B.');
  const [sending, setSending] = useState(false);

  const webhookUrl = `${API_URL}/whatsapp/webhook`;

  useEffect(() => {
    whatsappApi.getWhatsAppStatus()
      .then((s) => setConfigured(s.configured))
      .catch(() => setConfigured(false))
      .finally(() => setLoading(false));
  }, []);

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(
      () => toast({ type: 'success', message: 'Copiado al portapapeles' }),
      () => toast({ type: 'error', message: 'No se pudo copiar' }),
    );
  };

  const handleSend = async () => {
    if (!to.trim() || !message.trim()) return;
    setSending(true);
    try {
      await whatsappApi.sendWhatsApp(to.trim(), message.trim());
      toast({ type: 'success', message: `Mensaje enviado a ${to.trim()}` });
    } catch (err) {
      toast({ type: 'error', message: err instanceof Error ? err.message : 'No se pudo enviar el mensaje' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="card-accent">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
            <MessageCircle className="h-5 w-5 text-green-400" />
          </div>
          <div>
            <h4 className="font-medium text-white">WhatsApp</h4>
            <p className="text-[10px] text-slate-500">WhatsApp Business atendido por tu bot (vía Twilio)</p>
          </div>
        </div>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
        ) : configured ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-mono uppercase tracking-wider text-emerald-400">
            <CheckCircle2 className="h-3 w-3" /> Activo
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[9px] font-mono uppercase tracking-wider text-amber-400">
            <AlertCircle className="h-3 w-3" /> Por configurar
          </span>
        )}
      </div>

      {/* URL de webhook para pegar en Twilio */}
      <div className="mb-3">
        <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">
          URL de webhook (pegala en la consola de Twilio)
        </label>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-lg border border-slate-700/50 bg-surface-100 px-3 py-2 text-xs text-slate-300">
            {webhookUrl}
          </code>
          <button onClick={() => copy(webhookUrl)} className="btn-secondary text-xs py-2 px-2 shrink-0" title="Copiar">
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {configured ? (
        <div className="rounded-lg border border-slate-700/50 bg-surface-100/50 p-3">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Enviar mensaje de prueba</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="+54911..."
              className="input flex-1"
            />
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Mensaje"
              className="input flex-[2]"
            />
            <button onClick={handleSend} disabled={sending || !to.trim()} className="btn-primary text-xs whitespace-nowrap disabled:opacity-50">
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Enviar
            </button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-slate-400">
          El canal ya está listo en el sistema. Para activarlo, cargá las credenciales de Twilio
          (<code className="text-slate-300">TWILIO_ACCOUNT_SID</code>, <code className="text-slate-300">TWILIO_AUTH_TOKEN</code>,
          número de WhatsApp) en el servidor y configurá la URL de webhook de arriba en Twilio.
        </p>
      )}
    </div>
  );
}
