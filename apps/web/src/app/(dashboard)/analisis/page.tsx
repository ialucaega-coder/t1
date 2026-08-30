import { Brain, TrendingUp, BarChart3, DollarSign, Megaphone } from 'lucide-react';

const panels = [
  {
    name: 'Analista IA · Insights',
    subtitle: 'ENTIENDE CADA CONVERSACIÓN POR TI.',
    description: 'El Analista lee cada conversación de tu bot y te dice qué querían tus clientes, si quedaron contentos, qué objeciones salieron y qué ventas quedaron abiertas — sin que leas un solo chat.',
    icon: Brain,
  },
  {
    name: 'Mejoras',
    subtitle: 'TU BOT SE CORRIGE SOLO.',
    description: 'Mejoras detecta los huecos en el conocimiento de tu bot — lo que no supo responder — y te propone cómo corregirlo, o lo aplica solo.',
    icon: TrendingUp,
  },
  {
    name: 'Estadísticas',
    subtitle: 'EL PULSO DE TU BOT EN EL TIEMPO.',
    description: 'Volumen de conversaciones, retención de clientes y desempeño de tu bot, día a día.',
    icon: BarChart3,
  },
  {
    name: 'Costos',
    subtitle: 'CUÁNTO GASTA TU BOT EN IA.',
    description: 'Cuánto consume tu bot en IA cada mes, en claro, con un tope de presupuesto opcional para que el gasto nunca te sorprenda.',
    icon: DollarSign,
  },
  {
    name: 'Campañas',
    subtitle: 'DIFUSIONES Y SEGUIMIENTOS POR WHATSAPP.',
    description: 'Manda mensajes a tus segmentos de clientes por WhatsApp — promociones, avisos, seguimientos — directo desde el panel.',
    icon: Megaphone,
  },
];

export default function AnalisisPage() {
  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-400 max-w-2xl">
        Las herramientas del dashboard para <strong className="text-white">leer los datos de tu bot</strong> —
        qué pasó en las conversaciones, cómo mejorarlo, cuánto gastas y cómo va en el tiempo.
        Es distinto de los <span className="text-brand-400">superpoderes</span>, que son acciones que el bot hace solo.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {panels.map((panel) => {
          const Icon = panel.icon;
          return (
            <div key={panel.name} className="card-accent flex flex-col">
              <h3 className="font-semibold text-white mb-1">{panel.name}</h3>
              <p className="mono-label mb-3">{panel.subtitle}</p>
              <p className="text-sm text-slate-400 flex-1">{panel.description}</p>
              <button className="btn-secondary text-xs py-1.5 px-3 mt-4 self-start">
                ⓘ CÓMO FUNCIONA →
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
