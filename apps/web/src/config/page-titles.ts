export type PageMeta = {
  breadcrumb: string;
  title: string;
  counter?: string;
};

export const PAGE_TITLES: Record<string, PageMeta> = {
  '/dashboard': { breadcrumb: 'PANEL / MIS BOTS', title: 'Mis bots', counter: '0 BOTS' },
  '/habilidades': { breadcrumb: 'PANEL / HABILIDADES', title: 'Habilidades', counter: '8 SKILLS' },
  '/comandos': { breadcrumb: 'PANEL / COMANDOS', title: 'Comandos', counter: '33 COMANDOS' },
  '/prompt': { breadcrumb: 'PANEL / PROMPT', title: 'Gestión de prompts' },
  '/novedades': { breadcrumb: 'PANEL / NOVEDADES', title: 'Novedades' },
  '/conexiones': { breadcrumb: 'PANEL / CONEXIONES', title: 'Conexiones', counter: '5 CANALES' },
  '/plantillas': { breadcrumb: 'PANEL / PLANTILLAS DE WHATSAPP', title: 'Plantillas de WhatsApp', counter: '6 PROMPTS' },
  '/ia': { breadcrumb: 'PANEL / IA', title: 'IA', counter: '4 PROVEEDORES' },
  '/superpoderes': { breadcrumb: 'HERRAMIENTAS / SUPERPODERES', title: 'Superpoderes', counter: '12 PODERES' },
  '/analisis': { breadcrumb: 'HERRAMIENTAS / ANÁLISIS', title: 'Paneles de análisis', counter: '5 PANELES' },
  '/plantillas-negocio': { breadcrumb: 'HERRAMIENTAS / PLANTILLAS', title: 'Los 15 giros', counter: '15 PLANTILLAS' },
  '/equipo': { breadcrumb: 'TU BOT / EQUIPO', title: 'Equipo' },
  '/whitelabel': { breadcrumb: 'HERRAMIENTAS / WHITE-LABEL', title: 'White-label' },
  '/estadisticas': { breadcrumb: 'CRECIMIENTO / ESTADÍSTICAS', title: 'Estadísticas' },
  '/marketplace': { breadcrumb: 'HERRAMIENTAS / MARKETPLACE', title: 'Roadmap comunitario', counter: '29 IDEAS' },
  '/arena': { breadcrumb: 'COMUNIDAD', title: 'Arena', counter: '43 PROPUESTAS' },
  '/reservas': { breadcrumb: 'NEGOCIO / RESERVAS', title: 'Reservas', counter: '0 HOY' },
  '/servicios': { breadcrumb: 'NEGOCIO / SERVICIOS', title: 'Servicios' },
  '/productos': { breadcrumb: 'NEGOCIO / PRODUCTOS', title: 'Productos' },
  '/pos': { breadcrumb: 'NEGOCIO / POS', title: 'Punto de venta' },
  '/clientes': { breadcrumb: 'NEGOCIO / CLIENTES', title: 'Bandeja de clientes' },
  '/agencia': { breadcrumb: 'AGENCIA / MODO AGENCIA', title: 'Modo Agencia' },
  '/configuracion': { breadcrumb: 'CUENTA / CONFIGURACIÓN', title: 'Configuración' },
};
