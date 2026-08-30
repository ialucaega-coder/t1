import { ThumbsUp, Lightbulb } from 'lucide-react';

const ideas = [
  { id: 1, title: 'Atención por llamada (voz)', votes: 47, status: 'popular' },
  { id: 2, title: 'Sincronización con Google Calendar', votes: 42, status: 'popular' },
  { id: 3, title: 'White Label Agencia', votes: 38, status: 'building' },
  { id: 4, title: 'Voz Premium', votes: 35, status: 'popular' },
  { id: 5, title: 'Panel multi-negocio', votes: 33, status: 'popular' },
  { id: 6, title: 'Catálogo visual en el chat', votes: 31, status: 'planned' },
  { id: 7, title: 'Conexión con tu CRM', votes: 28, status: 'planned' },
  { id: 8, title: 'Voz Clínica', votes: 25, status: 'popular' },
  { id: 9, title: 'Pagos recurrentes automáticos', votes: 22, status: 'new' },
  { id: 10, title: 'Dashboard multi-idioma', votes: 19, status: 'new' },
  { id: 11, title: 'App móvil nativa', votes: 18, status: 'new' },
  { id: 12, title: 'Integración con Rappi/PedidosYa', votes: 15, status: 'new' },
];

const statusConfig: Record<string, { label: string; class: string }> = {
  popular: { label: 'POPULAR', class: 'bg-brand-400/10 text-brand-400 border-brand-400/20' },
  building: { label: 'EN DESARROLLO', class: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  planned: { label: 'PLANEADO', class: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
  new: { label: 'NUEVA', class: 'bg-slate-500/10 text-slate-400 border-slate-500/20' },
};

export default function MarketplacePage() {
  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-400 max-w-2xl">
        El roadmap de Local B lo votan los miembros. Vota los nichos, features y voces que quieres
        que se sumen — o propon la tuya. Lo más votado es lo que sigue.
      </p>

      <div className="flex items-center gap-3">
        <button className="btn-primary text-xs">
          <Lightbulb className="h-3.5 w-3.5" /> Proponer idea
        </button>
      </div>

      <div className="space-y-2">
        {ideas.map((idea, index) => {
          const config = statusConfig[idea.status];
          return (
            <div key={idea.id} className="card-accent flex items-center gap-4">
              <div className="text-center min-w-[50px]">
                <button className="flex flex-col items-center gap-1 text-slate-400 hover:text-brand-400 transition-colors">
                  <ThumbsUp className="h-4 w-4" />
                  <span className="text-sm font-bold">{idea.votes}</span>
                </button>
              </div>
              <div className="h-8 w-px bg-slate-700" />
              <div className="flex-1">
                <h4 className="text-sm font-medium text-white">{idea.title}</h4>
              </div>
              <span className={`badge border text-[9px] ${config.class}`}>
                {config.label}
              </span>
              <span className="text-xs font-mono text-slate-500 w-8 text-right">#{index + 1}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
