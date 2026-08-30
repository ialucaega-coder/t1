import { SKILLS as skills } from '@/constants/skills';

export default function HabilidadesPage() {
  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-400 max-w-2xl">
        Las habilidades son lo que tu bot <strong className="text-white">sabe hacer</strong> —
        cada una agrega una capacidad específica. Actívalas según lo que necesite tu negocio.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {skills.map((skill) => {
          const Icon = skill.icon;
          return (
            <div key={skill.name} className="card-accent flex flex-col">
              <div className="flex items-start justify-between mb-3">
                <Icon className="h-5 w-5 text-brand-400" />
                {skill.isActive ? (
                  <span className="badge-active">ACTIVO</span>
                ) : (
                  <span className="badge-active">ACTIVO</span>
                )}
              </div>
              <h3 className="font-semibold text-white mb-1">{skill.name}</h3>
              <p className="mono-label mb-2">{skill.subtitle}</p>
              <p className="text-sm text-slate-400 flex-1">{skill.description}</p>
              <div className="flex gap-2 mt-4">
                <button className="btn-secondary text-xs py-1.5 px-3">
                  Cómo funciona
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
