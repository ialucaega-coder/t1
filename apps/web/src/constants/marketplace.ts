export type MarketplaceCategory = 'Comercio' | 'Salud' | 'Gastronomía' | 'Servicios' | 'Educación';

export interface MarketplaceItem {
  id: string;
  name: string;
  description: string;
  category: MarketplaceCategory;
  rating: number;
  reviews: number;
  price: 'Gratis' | string;
  installed: boolean;
  author: string;
  icon: string;
}

export const MARKETPLACE_CATEGORIES: MarketplaceCategory[] = [
  'Comercio',
  'Salud',
  'Gastronomía',
  'Servicios',
  'Educación',
];

export const MOCK_MARKETPLACE_ITEMS: MarketplaceItem[] = [
  {
    id: '1',
    name: 'Bot de Reservas Inteligente',
    description: 'Gestiona citas automáticamente con confirmación por WhatsApp y recordatorios.',
    category: 'Servicios',
    rating: 4.8,
    reviews: 124,
    price: 'Gratis',
    installed: true,
    author: 'Local B',
    icon: 'calendar',
  },
  {
    id: '2',
    name: 'Catálogo Visual',
    description: 'Muestra productos con fotos, precios y botón de compra directo en el chat.',
    category: 'Comercio',
    rating: 4.6,
    reviews: 89,
    price: '$9.99/mes',
    installed: false,
    author: 'Local B',
    icon: 'shopping-bag',
  },
  {
    id: '3',
    name: 'Recordatorio de Citas Médicas',
    description: 'Envía recordatorios automáticos de consultas, exámenes y seguimientos.',
    category: 'Salud',
    rating: 4.9,
    reviews: 67,
    price: 'Gratis',
    installed: false,
    author: 'HealthBot MX',
    icon: 'heart-pulse',
  },
  {
    id: '4',
    name: 'Menú Digital QR',
    description: 'Genera menú interactivo con QR. Pedidos directos desde la mesa al bot.',
    category: 'Gastronomía',
    rating: 4.7,
    reviews: 203,
    price: '$4.99/mes',
    installed: false,
    author: 'FoodTech',
    icon: 'utensils',
  },
  {
    id: '5',
    name: 'Cobros con Clip / MercadoPago',
    description: 'Integra pagos sin salir del chat. Links de pago y confirmación automática.',
    category: 'Comercio',
    rating: 4.5,
    reviews: 156,
    price: '$14.99/mes',
    installed: false,
    author: 'PayBot',
    icon: 'credit-card',
  },
  {
    id: '6',
    name: 'Encuestas Post-Servicio',
    description: 'Envía encuestas de satisfacción automáticas después de cada atención.',
    category: 'Servicios',
    rating: 4.3,
    reviews: 45,
    price: 'Gratis',
    installed: true,
    author: 'Local B',
    icon: 'message-square',
  },
  {
    id: '7',
    name: 'Gestión de Turnos Escolares',
    description: 'Agenda reuniones con padres, envía comunicados y gestiona eventos.',
    category: 'Educación',
    rating: 4.4,
    reviews: 32,
    price: '$7.99/mes',
    installed: false,
    author: 'EduBot',
    icon: 'graduation-cap',
  },
  {
    id: '8',
    name: 'Delivery y Pedidos',
    description: 'Recibe pedidos por WhatsApp con dirección, menú y estado de entrega.',
    category: 'Gastronomía',
    rating: 4.6,
    reviews: 178,
    price: '$12.99/mes',
    installed: false,
    author: 'FoodTech',
    icon: 'truck',
  },
  {
    id: '9',
    name: 'Ficha Clínica Digital',
    description: 'Historial de pacientes accesible desde el chat. HIPAA-compatible.',
    category: 'Salud',
    rating: 4.7,
    reviews: 54,
    price: '$19.99/mes',
    installed: false,
    author: 'HealthBot MX',
    icon: 'clipboard-list',
  },
  {
    id: '10',
    name: 'Programa de Lealtad',
    description: 'Puntos, recompensas y cupones automáticos para clientes recurrentes.',
    category: 'Comercio',
    rating: 4.4,
    reviews: 91,
    price: '$9.99/mes',
    installed: false,
    author: 'LoyalBot',
    icon: 'gift',
  },
];
