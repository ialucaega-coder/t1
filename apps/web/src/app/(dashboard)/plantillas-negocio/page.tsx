import { Store } from 'lucide-react';

const giros = [
  { name: 'Restaurante', description: 'Reservas, menú y pedidos sin saturar el teléfono.' },
  { name: 'Cafetería', description: 'Órdenes, horarios y promos, al instante.' },
  { name: 'Panadería', description: 'Encargos y disponibilidad del día, solos.' },
  { name: 'Barbería', description: 'Llena la silla y baja los no-shows.' },
  { name: 'Salón de belleza', description: 'Agenda por servicio y por estilista.' },
  { name: 'Spa', description: 'Citas, paquetes y recordatorios que sí llegan.' },
  { name: 'Dentista', description: 'Agenda tratamientos y confirma asistencia.' },
  { name: 'Clínica', description: 'Triage básico, citas y seguimiento.' },
  { name: 'Gimnasio', description: 'Membresías, clases y retención.' },
  { name: 'Coach', description: 'Califica leads y agenda tus sesiones.' },
  { name: 'Inmobiliaria', description: 'Filtra prospectos y agenda visitas.' },
  { name: 'Tienda', description: 'Catálogo, stock y cierre de venta por chat.' },
  { name: 'Veterinaria', description: 'Citas, vacunas y recordatorios automáticos.' },
  { name: 'Hotel / Hostel', description: 'Disponibilidad, reservas y check-in por chat.' },
];

export default function PlantillasNegocioPage() {
  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-400 max-w-2xl">
        Cada giro es un <strong className="text-white">producto entero</strong>. Da click, copia el prompt y
        <strong className="text-white"> pégaselo a tu agente</strong> (Claude Code / Codex) en la carpeta de tu bot —
        ya trae tu licencia, así que baja el bot del giro, lo configura para tu negocio y lo deja listo para desplegar.
        Después ponle tu marca y revéndelo.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {giros.map((giro) => (
          <div key={giro.name} className="card-accent">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <Store className="h-5 w-5 text-brand-400" />
                <h3 className="font-semibold text-white">{giro.name}</h3>
              </div>
              <span className="badge border text-[9px] bg-slate-500/10 text-slate-400 border-slate-500/20">GIRO</span>
            </div>
            <p className="text-sm text-slate-400 mb-4">{giro.description}</p>
            <div className="flex gap-2">
              <button className="btn-primary text-xs py-1.5 px-3 flex-1">
                Actualizar a Local B+
              </button>
              <button className="btn-secondary text-xs py-1.5 px-3">
                Cómo funciona
              </button>
            </div>
            <p className="text-[10px] text-slate-500 mt-2 flex items-center gap-1">
              ✦ Pégaselo a tu agente
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
