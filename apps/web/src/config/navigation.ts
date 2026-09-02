import type { LucideIcon } from 'lucide-react';
import {
  LayoutGrid, Zap, Terminal, MessageSquare, Bell, Link2,
  MessageCircle, Bot, Sparkles, BarChart3, Users,
  PaintBucket, TrendingUp, Store, Trophy, Building2, UserCheck,
  Settings, CreditCard, Calendar, ShoppingBag, Shield,
  Map, Megaphone, DollarSign,
} from 'lucide-react';

export type NavItem = {
  name: string;
  href: string;
  icon: LucideIcon;
  badge?: string;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

export const NAVIGATION: NavGroup[] = [
  {
    label: 'PANEL',
    items: [
      { name: 'Mis bots', href: '/dashboard', icon: LayoutGrid },
      { name: 'Habilidades', href: '/habilidades', icon: Zap },
      { name: 'Comandos', href: '/comandos', icon: Terminal },
      { name: 'Prompt', href: '/prompt', icon: MessageSquare },
      { name: 'Novedades', href: '/novedades', icon: Bell },
      { name: 'Conexiones', href: '/conexiones', icon: Link2 },
      { name: 'Plantillas WhatsApp', href: '/plantillas', icon: MessageCircle },
      { name: 'IA', href: '/ia', icon: Bot },
      { name: 'Conversaciones', href: '/conversaciones', icon: MessageCircle },
    ],
  },
  {
    label: 'HERRAMIENTAS',
    items: [
      { name: 'Superpoderes', href: '/superpoderes', icon: Shield, badge: 'active' },
      { name: 'Análisis', href: '/analisis', icon: BarChart3, badge: 'active' },
      { name: 'Plantillas', href: '/plantillas-negocio', icon: Store, badge: 'active' },
      { name: 'Equipo', href: '/equipo', icon: Users, badge: 'new' },
      { name: 'White-label', href: '/whitelabel', icon: PaintBucket, badge: 'active' },
      { name: 'Estadísticas', href: '/estadisticas', icon: TrendingUp, badge: 'active' },
      { name: 'Marketplace', href: '/marketplace', icon: Map, badge: 'active' },
      { name: 'Campañas', href: '/campanas', icon: Megaphone, badge: 'new' },
      { name: 'Arena', href: '/arena', icon: Trophy, badge: 'prizes' },
    ],
  },
  {
    label: 'NEGOCIO',
    items: [
      { name: 'Reservas', href: '/reservas', icon: Calendar },
      { name: 'Servicios', href: '/servicios', icon: Sparkles },
      { name: 'Productos', href: '/productos', icon: ShoppingBag },
      { name: 'Órdenes', href: '/ordenes', icon: ShoppingBag },
      { name: 'Movimientos', href: '/movimientos', icon: DollarSign },
      { name: 'POS / Caja', href: '/pos', icon: CreditCard, badge: 'new' },
      { name: 'Clientes', href: '/clientes', icon: UserCheck },
    ],
  },
  {
    label: 'AGENCIA',
    items: [
      { name: 'Modo Agencia', href: '/agencia', icon: Building2, badge: 'active' },
    ],
  },
  {
    label: 'CUENTA',
    items: [
      { name: 'Configuración', href: '/configuracion', icon: Settings },
      { name: 'Facturación', href: '/facturacion', icon: CreditCard },
    ],
  },
];
