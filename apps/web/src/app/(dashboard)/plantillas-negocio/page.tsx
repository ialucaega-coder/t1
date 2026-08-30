import { Store } from 'lucide-react';
import { BUSINESS_TEMPLATES as giros } from '@/constants/business-templates';

export default function PlantillasNegocioPage() {
  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-400 max-w-2xl">
        Cada giro es un <strong className="text-white">producto entero</strong>. Da click, copia el prompt y
        <strong className="text-white"> pégaselo a tu agente</strong> (Claude Code / Codex) en la carpeta de tu bot —
        ya trae tu licencia, así que baja el bot del giro, lo configura para tu negocio y lo deja listo para desplegar.
        Después ponle tu marca y revéndelo.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {giros.map((giro) => (
          <div key={giro.name} className="card-accent">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <Store className="h-5 w-5 text-brand-400" />
                <h3 className="font-semibold text-white">{giro.name}</h3>
              </div>
              <span className="badge border text-[9px] bg-slate-500/10 text-slate-400 border-slate-500/20">GIRO</span>
            </div>
            <p className="text-sm text-slate-400 mb-4">{giro.description}</p>
            <div className="flex gap-2">
              <button className="btn-primary text-xs py-1.5 px-3 flex-1">
                Usar plantilla
              </button>
              <button className="btn-secondary text-xs py-1.5 px-3">
                Cómo funciona
              </button>
            </div>
            <p className="text-[10px] text-slate-500 mt-2 flex items-center gap-1">
              ✦ Incluido en tu plan
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
