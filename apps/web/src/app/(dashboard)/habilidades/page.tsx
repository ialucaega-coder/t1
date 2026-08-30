import { Zap, Calendar, ShoppingBag, MessageCircle, Mic, CreditCard, BarChart3, Bell } from 'lucide-react';

const skills = [
  {
    name: 'Reservas inteligentes',
    subtitle: 'AGENDA AUTOMÁTICA POR CHAT',
    description: 'Tus clientes reservan por WhatsApp, Telegram o web. El bot muestra horarios disponibles, confirma y envía recordatorio.',
    icon: Calendar,
    isActive: true,
  },
  {
    name: 'Catálogo & Pedidos',
    subtitle: 'VENDE DESDE EL CHAT',
    description: 'Muestra tus productos con fotos y precios. El cliente elige, arma su pedido y tú recibes la orden lista.',
    icon: ShoppingBag,
    isActive: true,
  },
  {
    name: 'Cobros por WhatsApp',
    subtitle: 'ENVÍA LINKS DE PAGO',
    description: 'Genera links de cobro y envíalos directo por el chat. Sin pasarela, sin fricciones.',
    icon: CreditCard,
    isActive: false,
  },
  {
    name: 'Recordatorios',
    subtitle: 'BAJA LOS NO-SHOWS',
    description: 'Envía recordatorio automático 24h y 1h antes de cada cita. Reduce las cancelaciones de último momento.',
    icon: Bell,
    isActive: true,
  },
  {
    name: 'Atención por voz',
    subtitle: 'RESPONDE LLAMADAS CON IA',
    description: 'Tu bot atiende llamadas, entiende lo que dicen y agenda o toma pedidos por teléfono. 24/7.',
    icon: Mic,
    isActive: false,
  },
  {
    name: 'Multi-canal',
    subtitle: 'WHATSAPP + TELEGRAM + WEB',
    description: 'Un solo panel para todos tus canales. Las conversaciones se centralizan y las métricas se cruzan.',
    icon: MessageCircle,
    isActive: true,
  },
  {
    name: 'Reportes automáticos',
    subtitle: 'MÉTRICAS SIN ABRIR EXCEL',
    description: 'Cada lunes recibes un reporte con reservas, ventas, no-shows y crecimiento. Directo a tu WhatsApp.',
    icon: BarChart3,
    isActive: false,
  },
  {
    name: 'Superpoderes',
    subtitle: 'BLINDAJE + VIGILANTE + MÁS',
    description: 'Protege tu bot contra inventos, detecta oportunidades de venta y automatiza el seguimiento post-venta.',
    icon: Zap,
    isActive: false,
  },
];

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
                  <span className="badge-premium">PRO+</span>
                )}
              </div>
              <h3 className="font-semibold text-white mb-1">{skill.name}</h3>
              <p className="mono-label mb-2">{skill.subtitle}</p>
              <p className="text-sm text-slate-400 flex-1">{skill.description}</p>
              <div className="flex gap-2 mt-4">
                {!skill.isActive && (
                  <button className="btn-primary text-xs py-1.5 px-3">
                    Actualizar a Local B+
                  </button>
                )}
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
