'use client';

import { useState } from 'react';
import { ToggleLeft, ToggleRight, Info } from 'lucide-react';
import { useSkills } from '@/hooks/use-skills';
import * as skillsApi from '@/lib/api/skills';
import { useToast } from '@/components/common/Toast';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import { usePageCounter, fmtCounter } from '@/stores/page-counter';

export default function HabilidadesPage() {
  const { toast } = useToast();
  const { skills, isLoading, error, refetch } = useSkills();
  const [toggling, setToggling] = useState<string | null>(null);

  // Contador vivo del header: habilidades activas (reacciona al togglear).
  usePageCounter(isLoading ? null : fmtCounter(skills.filter((s) => s.isActive).length, 'ACTIVA', 'ACTIVAS'));

  async function handleToggle(name: string, currentActive: boolean) {
    setToggling(name);
    try {
      await skillsApi.updateSkill(name, { isActive: !currentActive });
      refetch();
      toast({ type: 'success', message: `Habilidad ${!currentActive ? 'activada' : 'desactivada'}` });
    } catch (err) {
      console.error('Error toggling skill:', err);
      toast({ type: 'error', message: 'Error al cambiar estado de la habilidad' });
    } finally {
      setToggling(null);
    }
  }

  if (isLoading) return <LoadingSpinner label="Cargando habilidades..." />;

  const activeCount = skills.filter((s) => s.isActive).length;

  return (
    <div className="space-y-4">
      {error && <ErrorAlert message={error} onRetry={refetch} />}

      <div>
        <h1 className="text-xl font-bold text-white">Habilidades</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          {activeCount} de {skills.length} activa{activeCount !== 1 ? 's' : ''}
        </p>
      </div>

      <p className="text-sm text-slate-400 max-w-2xl">
        Las habilidades resumen lo que tu bot <strong className="text-white">sabe hacer</strong>.
      </p>

      <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-200 max-w-3xl">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <div className="space-y-1.5 leading-relaxed">
          <p>
            <strong className="text-amber-100">Hoy estas habilidades son informativas:</strong> activarlas o
            desactivarlas no cambia lo que responde el bot en el chat.
          </p>
          <p>
            Lo que sí influye en el bot son los <strong className="text-amber-100">Superpoderes</strong> (sección
            Superpoderes) y los ajustes con su propio interruptor, como el{' '}
            <strong className="text-amber-100">Asistente de voz</strong> (Activo/Inactivo en su pantalla).
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {skills.map((skill) => {
          const Icon = skill.icon;
          const isToggling = toggling === skill.name;
          return (
            <div
              key={skill.name}
              className={`rounded-xl border p-4 flex flex-col transition-all ${
                skill.isActive
                  ? 'border-brand-400/30 bg-brand-400/5'
                  : 'border-slate-700/50 bg-slate-800/30'
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2.5">
                  <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${
                    skill.isActive ? 'bg-brand-400/15' : 'bg-slate-700/50'
                  }`}>
                    <Icon className={`h-4 w-4 ${skill.isActive ? 'text-brand-400' : 'text-slate-500'}`} />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">{skill.name}</h3>
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider">{skill.subtitle}</span>
                    <span className="ml-1.5 align-middle text-[9px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-400">Informativa</span>
                  </div>
                </div>
                <button
                  onClick={() => handleToggle(skill.name, skill.isActive)}
                  disabled={isToggling}
                  className="shrink-0 mt-0.5 disabled:opacity-50"
                  title={skill.isActive ? 'Desactivar' : 'Activar'}
                >
                  {skill.isActive ? (
                    <ToggleRight className="h-6 w-6 text-emerald-400" />
                  ) : (
                    <ToggleLeft className="h-6 w-6 text-slate-600" />
                  )}
                </button>
              </div>
              <p className="text-xs text-slate-400 flex-1 mt-1 leading-relaxed">{skill.description}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
