'use client';

import { useState, useEffect, useCallback } from 'react';
import { Store, Zap, Clock, Wrench, MessageSquare, ChevronRight, Check } from 'lucide-react';
import * as industryTemplatesApi from '@/lib/api/industryTemplates';
import type { IndustryTemplate } from '@/lib/api/industryTemplates';
import { useToast } from '@/components/common/Toast';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';

function formatPrice(price: number) {
  if (!price) return 'Sin cargo';
  return price.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
}

export default function PlantillasNegocioPage() {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<IndustryTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [applying, setApplying] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<IndustryTemplate | null>(null);

  const fetchTemplates = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await industryTemplatesApi.getIndustryTemplates();
      setTemplates(data);
      setError('');
    } catch {
      setError('Error al cargar las plantillas por giro');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  async function handleApply(template: IndustryTemplate) {
    setApplying(template.id);
    setConfirmTarget(null);
    try {
      const result = await industryTemplatesApi.applyIndustryTemplate(template.id);
      toast({
        type: 'success',
        message: `Plantilla "${template.nombre}" aplicada: ${result.serviciosCreados} servicios nuevos, prompt configurado y ${result.superpoderesActivados.length} superpoderes activados.`,
      });
    } catch {
      toast({ type: 'error', message: 'No se pudo aplicar la plantilla' });
    } finally {
      setApplying(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && <ErrorAlert message={error} onRetry={fetchTemplates} />}

      <ConfirmDialog
        isOpen={confirmTarget !== null}
        onClose={() => setConfirmTarget(null)}
        onConfirm={() => { if (confirmTarget) handleApply(confirmTarget); }}
        title="Aplicar plantilla"
        message={
          confirmTarget
            ? `Vas a precargar tu negocio con los servicios, el prompt y los superpoderes de "${confirmTarget.nombre}". Los servicios que ya existan no se duplican. ¿Continuar?`
            : ''
        }
        confirmLabel="Usar esta plantilla"
      />

      <div>
        <h1 className="text-xl font-bold text-white">Bots por giro</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Elegí tu rubro y desplegá tu negocio en 1 click: precargamos servicios típicos, la personalidad del bot y los superpoderes recomendados.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {templates.map((t) => (
            <div
              key={t.id}
              className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-4 flex flex-col gap-3"
            >
              <div className="flex items-start gap-2">
                <span className="text-2xl leading-none" aria-hidden>{t.icono}</span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-white">{t.nombre}</h3>
                  <p className="text-xs text-slate-500 line-clamp-2">{t.descripcion}</p>
                </div>
              </div>

              {/* Servicios */}
              <div className="rounded-lg bg-slate-900/50 p-2.5 space-y-1.5">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500">
                  <Wrench className="h-3 w-3" /> Servicios ({t.servicios.length})
                </div>
                {t.servicios.slice(0, 4).map((s) => (
                  <div key={s.name} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-slate-300 truncate">{s.name}</span>
                    <span className="flex items-center gap-2 shrink-0 text-slate-500">
                      <span className="inline-flex items-center gap-0.5">
                        <Clock className="h-2.5 w-2.5" />{s.durationMin}m
                      </span>
                      <span className="text-brand-400">{formatPrice(s.price)}</span>
                    </span>
                  </div>
                ))}
              </div>

              {/* Prompt */}
              <div className="rounded-lg bg-slate-900/50 p-2.5">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                  <MessageSquare className="h-3 w-3" /> Personalidad del bot
                </div>
                <p className="text-[11px] text-slate-400 line-clamp-3 leading-relaxed">{t.prompt}</p>
              </div>

              {/* Superpoderes */}
              <div>
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">
                  <Zap className="h-3 w-3 text-yellow-400" /> Superpoderes
                </div>
                <div className="flex flex-wrap gap-1">
                  {t.superpoderes.map((sp) => (
                    <span
                      key={sp}
                      className="px-2 py-0.5 rounded-full text-[10px] border bg-brand-400/10 text-brand-400 border-brand-400/20"
                    >
                      {sp}
                    </span>
                  ))}
                </div>
              </div>

              <button
                onClick={() => setConfirmTarget(t)}
                disabled={applying === t.id}
                className="btn-primary text-xs w-full justify-center disabled:opacity-50 mt-auto"
              >
                {applying === t.id ? (
                  'Aplicando...'
                ) : (
                  <>Usar esta plantilla <ChevronRight className="h-3 w-3" /></>
                )}
              </button>
            </div>
          ))}
        </div>
      )}

      {!isLoading && !error && templates.length > 0 && (
        <p className="flex items-center gap-1.5 text-[11px] text-slate-500 pt-1">
          <Check className="h-3 w-3 text-emerald-400" />
          Al aplicar, los servicios que ya tengas cargados no se duplican.
        </p>
      )}
    </div>
  );
}
