import {
  Zap, Calendar, ShoppingBag, MessageCircle, Mic, CreditCard, BarChart3, Bell,
  type LucideIcon,
} from 'lucide-react';

export interface Skill {
  name: string;
  subtitle: string;
  description: string;
  icon: LucideIcon;
  isActive: boolean;
}

export const SKILLS: Skill[] = [
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
    isActive: true,
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
    isActive: true,
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
    isActive: true,
  },
  {
    name: 'Superpoderes',
    subtitle: 'BLINDAJE + VIGILANTE + MÁS',
    description: 'Protege tu bot contra inventos, detecta oportunidades de venta y automatiza el seguimiento post-venta.',
    icon: Zap,
    isActive: true,
  },
];
