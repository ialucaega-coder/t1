import {
  Shield, Eye, Siren, Target, Receipt, FileBarChart,
  BellRing, Lock, Brain, Zap, Gauge, Sword,
} from 'lucide-react';

const superpoderes = [
  { name: 'Blindaje anti-invento', subtitle: 'NO DEJA QUE EL BOT INVENTE.', description: 'Si el bot no sabe, dice que no sabe. Cero alucinaciones, cero respuestas inventadas que pueden costar un cliente.', icon: Shield, isActive: true },
  { name: 'Vigilante', subtitle: 'DETECTA PROBLEMAS EN TIEMPO REAL.', description: 'Monitorea las conversaciones y te avisa cuando un cliente está molesto, confundido, o a punto de irse.', icon: Eye, isActive: true },
  { name: 'Cazador de ventas', subtitle: 'DETECTA OPORTUNIDADES DE VENTA.', description: 'Lee entre líneas y te avisa cuando un cliente muestra interés de compra — para que tú cierres.', icon: Target, isActive: true },
  { name: 'Cobros por WhatsApp', subtitle: 'COBRA SIN FRICCIÓN.', description: 'Genera links de pago y los envía por el chat. El cliente paga sin salir de la conversación.', icon: Receipt, isActive: false },
  { name: 'Reportes automáticos', subtitle: 'REPORTE SEMANAL SIN MOVER UN DEDO.', description: 'Cada lunes recibes un resumen: conversaciones, ventas, no-shows, tendencias. Directo a tu WhatsApp.', icon: FileBarChart, isActive: true },
  { name: 'Recordatorios inteligentes', subtitle: 'BAJA LOS NO-SHOWS A CERO.', description: 'Envía recordatorio 24h y 1h antes de cada cita. Adapta el mensaje según el historial del cliente.', icon: BellRing, isActive: true },
  { name: 'Modo seguro', subtitle: 'FILTRA CONTENIDO INAPROPIADO.', description: 'Detecta y bloquea mensajes ofensivos, spam o intentos de manipular al bot.', icon: Lock, isActive: true },
  { name: 'Analista IA', subtitle: 'ENTIENDE CADA CONVERSACIÓN.', description: 'Lee todas las conversaciones y te dice: qué quería el cliente, si quedó contento, qué objeciones hubo.', icon: Brain, isActive: false },
  { name: 'Auto-mejora', subtitle: 'EL BOT SE CORRIGE SOLO.', description: 'Detecta los huecos en el conocimiento del bot y propone correcciones. Opcional: las aplica solo.', icon: Zap, isActive: false },
  { name: 'Turbo respuesta', subtitle: 'RESPONDE EN MENOS DE 2 SEGUNDOS.', description: 'Optimiza la velocidad de respuesta del bot usando cache inteligente y priorización de mensajes.', icon: Gauge, isActive: true },
  { name: 'Seguimiento post-venta', subtitle: 'NO PIERDAS AL CLIENTE DESPUÉS.', description: 'Envía seguimiento automático después de la compra: satisfacción, reseña, próxima cita.', icon: Sword, isActive: false },
  { name: 'Alerta de emergencia', subtitle: 'AVISA CUANDO ES URGENTE.', description: 'Detecta situaciones urgentes (cliente VIP, queja grave, pedido grande) y te notifica al instante.', icon: Siren, isActive: true },
];

export default function SuperpoderesPage() {
  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-400 max-w-2xl">
        Los superpoderes son acciones que <strong className="text-white">tu bot hace solo</strong> —
        protege, detecta, avisa y actúa sin que tú intervengas.
        Es distinto de los paneles de análisis, que son herramientas para leer datos.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {superpoderes.map((power) => {
          const Icon = power.icon;
          return (
            <div key={power.name} className="card-accent flex flex-col">
              <div className="flex items-start justify-between mb-3">
                <Icon className="h-5 w-5 text-brand-400" />
                {power.isActive ? (
                  <span className="badge-active">ACTIVO</span>
                ) : (
                  <span className="badge-premium">LOCAL+</span>
                )}
              </div>
              <h3 className="font-semibold text-white mb-1">{power.name}</h3>
              <p className="mono-label mb-2">{power.subtitle}</p>
              <p className="text-sm text-slate-400 flex-1">{power.description}</p>
              <div className="flex gap-2 mt-4">
                {!power.isActive && (
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
