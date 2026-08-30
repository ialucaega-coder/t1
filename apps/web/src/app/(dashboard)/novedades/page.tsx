const novedades = [
  {
    version: 'v1.2.0',
    date: '28 ago 2026',
    title: 'POS / Punto de venta',
    description: 'Nuevo módulo de caja registradora integrado. Cobra en efectivo, tarjeta, transferencia o QR. Historial de transacciones y cierre de caja diario.',
    tags: ['NUEVO', 'POS'],
  },
  {
    version: 'v1.1.5',
    date: '20 ago 2026',
    title: 'Notificaciones multi-canal',
    description: 'Envía recordatorios y confirmaciones por WhatsApp, Telegram, email o SMS. Configura cuándo y por dónde avisar a cada cliente.',
    tags: ['MEJORA'],
  },
  {
    version: 'v1.1.0',
    date: '10 ago 2026',
    title: 'Calendario visual de reservas',
    description: 'Vista de calendario semanal y diaria con drag-and-drop para mover reservas. Filtra por profesional y servicio.',
    tags: ['NUEVO', 'RESERVAS'],
  },
  {
    version: 'v1.0.5',
    date: '1 ago 2026',
    title: 'Equipo & Roles',
    description: 'Invita a tu equipo con roles diferenciados. Administrador ve todo, Equipo solo opera. Links de invitación de un solo uso con expiración a 7 días.',
    tags: ['NUEVO', 'EQUIPO'],
  },
  {
    version: 'v1.0.0',
    date: '15 jul 2026',
    title: 'Lanzamiento Local B',
    description: 'Primera versión estable. Dashboard completo con reservas, servicios, productos, clientes y conexiones multi-canal.',
    tags: ['LANZAMIENTO'],
  },
];

export default function NovedadesPage() {
  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-400 max-w-2xl">
        Lo que hay de nuevo en Local B — features, mejoras y fixes. Cada update se aplica automáticamente.
      </p>

      <div className="relative">
        <div className="absolute left-[7px] top-2 bottom-2 w-px bg-slate-800" />

        <div className="space-y-8">
          {novedades.map((item) => (
            <div key={item.version} className="relative pl-8">
              <div className="absolute left-0 top-1.5 h-3.5 w-3.5 rounded-full border-2 border-brand-500 bg-surface" />

              <div className="card-accent">
                <div className="flex items-center gap-3 mb-2">
                  <code className="text-xs font-mono text-brand-400">{item.version}</code>
                  <span className="text-xs text-slate-500">{item.date}</span>
                  <div className="flex gap-1.5 ml-auto">
                    {item.tags.map((tag) => (
                      <span key={tag} className={`text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border ${
                        tag === 'NUEVO' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                        tag === 'MEJORA' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
                        tag === 'LANZAMIENTO' ? 'bg-brand-500/10 text-brand-400 border-brand-500/20' :
                        'bg-slate-500/10 text-slate-400 border-slate-500/20'
                      }`}>
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <h3 className="font-semibold text-white mb-1">{item.title}</h3>
                <p className="text-sm text-slate-400">{item.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
