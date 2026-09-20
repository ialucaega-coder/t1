'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Save, Sparkles, Info, Lock } from 'lucide-react';
import { brandApi } from '@/lib/api/index';
import type { BrandVoice } from '@/lib/api/brand';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/components/common/Toast';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';

const EMPTY: BrandVoice = {
  tono: '',
  publicoObjetivo: '',
  infoNegocio: '',
  reglas: '',
  emojis: true,
};

export default function VozDeMarcaPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.role === 'ADMIN';

  const [form, setForm] = useState<BrandVoice>(EMPTY);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const data = await brandApi.getBrandVoice();
        if (!cancelled) setForm(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Error al cargar la Voz de Marca');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [reloadToken]);

  const updateField = <K extends keyof BrandVoice>(field: K, value: BrandVoice[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    try {
      const saved = await brandApi.updateBrandVoice(form);
      setForm(saved);
      toast({ type: 'success', message: 'Voz de Marca guardada correctamente' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al guardar la Voz de Marca';
      toast({ type: 'error', message: msg });
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return <LoadingSpinner label="Cargando Voz de Marca..." />;
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-3xl space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <Sparkles className="h-6 w-6 text-brand-400" />
          <h1 className="text-2xl font-bold text-white">Voz de Marca</h1>
        </div>
        <p className="text-sm text-slate-400 max-w-2xl mt-1">
          La identidad de tu bot en <strong className="text-white">todos los canales</strong> (WhatsApp, Telegram, web y voz).
          Definí cómo habla, a quién le habla y qué sabe de tu negocio. Se aplica automáticamente a cada respuesta.
        </p>
      </div>

      {error && <ErrorAlert message={error} onRetry={() => setReloadToken((t) => t + 1)} />}

      {!isAdmin && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
          <Lock className="h-3.5 w-3.5" />
          Solo un administrador puede editar la Voz de Marca. Podés verla pero no guardarla.
        </div>
      )}

      <section className="card space-y-4">
        <div className="flex items-center gap-3">
          <Info className="h-5 w-5 text-brand-400" />
          <h3 className="font-semibold text-white">Personalidad</h3>
        </div>

        <div>
          <label className="text-xs text-slate-500 mb-1 block">Tono y estilo</label>
          <input
            className="input"
            value={form.tono}
            disabled={!isAdmin}
            onChange={(e) => updateField('tono', e.target.value)}
            placeholder="Ej: cercano y profesional, tuteo, frases cortas"
          />
        </div>

        <div>
          <label className="text-xs text-slate-500 mb-1 block">Público objetivo</label>
          <input
            className="input"
            value={form.publicoObjetivo}
            disabled={!isAdmin}
            onChange={(e) => updateField('publicoObjetivo', e.target.value)}
            placeholder="Ej: dueños de PyMEs en Argentina que quieren automatizar su atención"
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-white">Usar emojis</p>
            <p className="text-xs text-slate-500">Permite que el bot use emojis con moderación.</p>
          </div>
          <button
            type="button"
            onClick={() => isAdmin && updateField('emojis', !form.emojis)}
            disabled={!isAdmin}
            className={`relative w-11 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/50 ${
              form.emojis ? 'bg-brand-500' : 'bg-slate-600'
            } ${!isAdmin ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform shadow-sm ${
                form.emojis ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </section>

      <section className="card space-y-4">
        <div className="flex items-center gap-3">
          <Info className="h-5 w-5 text-brand-400" />
          <h3 className="font-semibold text-white">Conocimiento del negocio</h3>
        </div>

        <div>
          <label className="text-xs text-slate-500 mb-1 block">Información y preguntas frecuentes</label>
          <textarea
            className="input min-h-[160px] resize-y"
            value={form.infoNegocio}
            disabled={!isAdmin}
            onChange={(e) => updateField('infoNegocio', e.target.value)}
            placeholder="Escribí en texto libre lo que el bot debe saber: qué vendés, políticas, horarios, formas de pago, preguntas frecuentes y sus respuestas..."
          />
          <p className="text-[11px] text-slate-500 mt-1">
            El bot usa este texto como fuente de verdad para responder. Cuanto más completo, mejor.
          </p>
        </div>

        <div>
          <label className="text-xs text-slate-500 mb-1 block">Reglas propias</label>
          <textarea
            className="input min-h-[100px] resize-y"
            value={form.reglas}
            disabled={!isAdmin}
            onChange={(e) => updateField('reglas', e.target.value)}
            placeholder="Ej: nunca prometer descuentos, siempre ofrecer agendar, derivar a humano si preguntan por reembolsos"
          />
        </div>
      </section>

      {isAdmin && (
        <div className="flex justify-end">
          <button type="submit" disabled={isSaving} className="btn-primary text-sm">
            <Save className="h-4 w-4" /> {isSaving ? 'Guardando...' : 'Guardar Voz de Marca'}
          </button>
        </div>
      )}
    </form>
  );
}
