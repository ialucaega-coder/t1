'use client';

import { useState } from 'react';
import { CreditCard, Link2, Copy, Check, Loader2, AlertTriangle, MessageCircle, Sparkles } from 'lucide-react';
import * as billingApi from '@/lib/api/billing';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/components/common/Toast';

const inputCls = 'w-full rounded-lg bg-slate-900/60 border border-slate-700 focus:border-brand-500 focus:ring-1 focus:ring-brand-500/40 outline-none px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500';

export default function CobrosPage() {
  const { business } = useAuth();
  const { toast } = useToast();
  const currency = business?.currency || 'USD';

  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    const value = parseFloat(amount);
    if (!value || value <= 0) { toast({ type: 'error', message: 'Ingresá un monto válido.' }); return; }
    if (!description.trim()) { toast({ type: 'error', message: 'Agregá una descripción del cobro.' }); return; }
    setLoading(true);
    setLink('');
    try {
      const { url } = await billingApi.createPaymentLink(value, description.trim(), currency);
      setLink(url);
      toast({ type: 'success', message: 'Link de cobro generado.' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'No se pudo generar el link';
      toast({ type: 'error', message: msg.includes('STRIPE') || msg.includes('configurad') ? 'Falta configurar Stripe (STRIPE_SECRET_KEY).' : msg });
    } finally {
      setLoading(false);
    }
  };

  const copy = () => {
    if (!link) return;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const waHref = link
    ? `https://wa.me/?text=${encodeURIComponent(`Hola! Podés pagar ${description || 'tu compra'} de forma segura acá: ${link}`)}`
    : '#';

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-brand-500/15 border border-brand-500/30 flex items-center justify-center">
          <CreditCard className="w-5 h-5 text-brand-400" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-white flex items-center gap-2">
            Cobros
            <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-brand-500/20 text-brand-300 border border-brand-500/30">Nuevo</span>
          </h1>
          <p className="text-sm text-slate-400">Del sí al pagado sin salir del chat: generá un link de pago y mandáselo al cliente.</p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-700/60 bg-slate-800/40 p-5 space-y-4">
        <div className="grid sm:grid-cols-[1fr_2fr] gap-3">
          <label className="block">
            <span className="block text-xs font-medium text-slate-300 mb-1">Monto ({currency})</span>
            <input className={inputCls} type="number" min="0" step="0.01" inputMode="decimal" placeholder="1500" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-slate-300 mb-1">Descripción</span>
            <input className={inputCls} placeholder="Seña de turno / Corte + color" value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
        </div>

        <button onClick={generate} disabled={loading} className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-lg bg-brand-500 hover:bg-brand-400 disabled:opacity-50 text-white transition">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
          {loading ? 'Generando…' : 'Generar link de cobro'}
        </button>

        {link && (
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4 space-y-3">
            <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2">
              <code className="flex-1 text-xs text-slate-200 break-all">{link}</code>
              <button onClick={copy} className="text-slate-400 hover:text-white transition shrink-0" title="Copiar">
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <a href={waHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white transition">
              <MessageCircle className="w-4 h-4" /> Enviar por WhatsApp
            </a>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-700/60 bg-slate-800/40 p-5">
        <div className="flex items-center gap-2 text-slate-200 font-medium mb-2"><Sparkles className="w-4 h-4 text-brand-400" /> Cómo funciona</div>
        <ol className="text-sm text-slate-400 space-y-1.5 list-decimal list-inside">
          <li>Ponés el monto y una descripción del cobro.</li>
          <li>Generás un link seguro de pago con tarjeta (Stripe).</li>
          <li>Se lo mandás al cliente por WhatsApp o el canal que uses.</li>
          <li>El cliente paga y te queda registrado.</li>
        </ol>
        <p className="mt-3 text-xs text-amber-300/90 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Requiere configurar Stripe (STRIPE_SECRET_KEY) para generar cobros reales.
        </p>
      </div>
    </div>
  );
}
