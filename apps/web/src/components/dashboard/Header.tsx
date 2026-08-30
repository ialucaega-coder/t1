'use client';

import { usePathname } from 'next/navigation';
import { Bell, Search } from 'lucide-react';

const pageTitles: Record<string, { breadcrumb: string; title: string; counter?: string }> = {
  '/dashboard': { breadcrumb: 'PANEL / MIS BOTS', title: 'Mis bots', counter: '0 BOTS' },
  '/habilidades': { breadcrumb: 'PANEL / HABILIDADES', title: 'Habilidades', counter: '8 SKILLS' },
  '/comandos': { breadcrumb: 'PANEL / COMANDOS', title: 'Comandos', counter: '33 COMANDOS' },
  '/prompt': { breadcrumb: 'PANEL / PROMPT', title: 'Gestión de prompts' },
  '/novedades': { breadcrumb: 'PANEL / NOVEDADES', title: 'Novedades' },
  '/conexiones': { breadcrumb: 'PANEL / CONEXIONES', title: 'Conexiones', counter: '5 CANALES' },
  '/plantillas': { breadcrumb: 'PANEL / PLANTILLAS DE WHATSAPP', title: 'Plantillas de WhatsApp', counter: '6 PROMPTS' },
  '/ia': { breadcrumb: 'PANEL / IA', title: 'IA', counter: '4 PROVEEDORES' },
  '/superpoderes': { breadcrumb: 'LOCAL B+ / SUPERPODERES', title: 'Superpoderes', counter: '12 PODERES' },
  '/analisis': { breadcrumb: 'LOCAL B+ / ANÁLISIS', title: 'Paneles de análisis', counter: '5 PANELES' },
  '/plantillas-negocio': { breadcrumb: 'LOCAL B+ / PLANTILLAS', title: 'Los 14 giros', counter: '14 PLANTILLAS' },
  '/equipo': { breadcrumb: 'TU BOT / EQUIPO', title: 'Equipo' },
  '/whitelabel': { breadcrumb: 'LOCAL B+ / WHITE-LABEL', title: 'White-label' },
  '/estadisticas': { breadcrumb: 'CRECIMIENTO / ESTADÍSTICAS', title: 'Estadísticas' },
  '/marketplace': { breadcrumb: 'LOCAL B+ / MARKETPLACE', title: 'Roadmap comunitario', counter: '29 IDEAS' },
  '/arena': { breadcrumb: 'COMUNIDAD', title: 'Arena', counter: '43 PROPUESTAS' },
  '/reservas': { breadcrumb: 'NEGOCIO / RESERVAS', title: 'Reservas', counter: '0 HOY' },
  '/servicios': { breadcrumb: 'NEGOCIO / SERVICIOS', title: 'Servicios' },
  '/productos': { breadcrumb: 'NEGOCIO / PRODUCTOS', title: 'Productos' },
  '/pos': { breadcrumb: 'NEGOCIO / POS', title: 'Punto de venta' },
  '/clientes': { breadcrumb: 'NEGOCIO / CLIENTES', title: 'Bandeja de clientes' },
  '/agencia': { breadcrumb: 'AGENCIA / MODO AGENCIA', title: 'Modo Agencia' },
  '/configuracion': { breadcrumb: 'CUENTA / CONFIGURACIÓN', title: 'Configuración' },
};

export function Header() {
  const pathname = usePathname();
  const page = pageTitles[pathname] || { breadcrumb: 'PANEL', title: 'Local B' };

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-700/50 bg-surface/80 backdrop-blur-sm px-8 py-4">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-1">
          {page.breadcrumb}
        </p>
        <h2 className="text-xl font-bold text-white">{page.title}</h2>
      </div>

      <div className="flex items-center gap-3">
        {page.counter && (
          <div className="counter-badge">
            {page.counter}
          </div>
        )}
        <button className="rounded-lg p-2 text-slate-400 hover:bg-surface-100 hover:text-white transition-colors">
          <Search className="h-4 w-4" />
        </button>
        <button className="relative rounded-lg p-2 text-slate-400 hover:bg-surface-100 hover:text-white transition-colors">
          <Bell className="h-4 w-4" />
          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-brand-400" />
        </button>
      </div>
    </header>
  );
}
