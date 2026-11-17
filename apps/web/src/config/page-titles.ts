export type PageMeta = {
  breadcrumb: string;
  title: string;
};

// NOTA: el "contador" que muestra el Header al lado del título ya NO vive acá
// (antes era un string hardcodeado como '0 BOTS' que nunca reflejaba datos
// reales). Ahora cada página empuja su conteo real vía `usePageCounter(...)`
// del store `@/stores/page-counter`, y el Header lo lee. Ver Header.tsx.
export const PAGE_TITLES: Record<string, PageMeta> = {
  '/dashboard': { breadcrumb: 'PANEL / MIS BOTS', title: 'Mis bots' },
  '/habilidades': { breadcrumb: 'PANEL / HABILIDADES', title: 'Habilidades' },
  '/comandos': { breadcrumb: 'PANEL / COMANDOS', title: 'Comandos' },
  '/prompt': { breadcrumb: 'PANEL / PROMPT', title: 'Gestión de prompts' },
  '/novedades': { breadcrumb: 'PANEL / NOTIFICACIONES', title: 'Notificaciones' },
  '/conexiones': { breadcrumb: 'PANEL / CONEXIONES', title: 'Conexiones' },
  '/plantillas': { breadcrumb: 'PANEL / PLANTILLAS DE WHATSAPP', title: 'Plantillas de WhatsApp' },
  '/ia': { breadcrumb: 'PANEL / IA', title: 'IA' },
  '/superpoderes': { breadcrumb: 'HERRAMIENTAS / SUPERPODERES', title: 'Superpoderes' },
  '/analisis': { breadcrumb: 'HERRAMIENTAS / ANÁLISIS', title: 'Paneles de análisis' },
  '/plantillas-negocio': { breadcrumb: 'HERRAMIENTAS / PLANTILLAS', title: 'Los 15 giros' },
  '/equipo': { breadcrumb: 'TU BOT / EQUIPO', title: 'Equipo' },
  '/whitelabel': { breadcrumb: 'HERRAMIENTAS / WHITE-LABEL', title: 'White-label' },
  '/estadisticas': { breadcrumb: 'CRECIMIENTO / ESTADÍSTICAS', title: 'Estadísticas' },
  '/marketplace': { breadcrumb: 'HERRAMIENTAS / MARKETPLACE', title: 'Roadmap comunitario' },
  '/arena': { breadcrumb: 'COMUNIDAD', title: 'Arena' },
  '/reservas': { breadcrumb: 'NEGOCIO / RESERVAS', title: 'Reservas' },
  '/servicios': { breadcrumb: 'NEGOCIO / SERVICIOS', title: 'Servicios' },
  '/productos': { breadcrumb: 'NEGOCIO / PRODUCTOS', title: 'Productos' },
  '/pos': { breadcrumb: 'NEGOCIO / POS', title: 'Punto de venta' },
  '/clientes': { breadcrumb: 'NEGOCIO / CLIENTES', title: 'Bandeja de clientes' },
  '/agencia': { breadcrumb: 'AGENCIA / MODO AGENCIA', title: 'Modo Agencia' },
  '/configuracion': { breadcrumb: 'CUENTA / CONFIGURACIÓN', title: 'Configuración' },
};
