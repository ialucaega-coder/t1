import {
  Shield, Eye, Siren, Target, Receipt, FileBarChart,
  BellRing, Lock, Brain, Zap, Gauge, Sword, Sparkles, Languages,
  Star, ThumbsUp, CalendarClock, Images,
  type LucideIcon,
} from 'lucide-react';

export interface Superpower {
  name: string;
  subtitle: string;
  description: string;
  icon: LucideIcon;
  isActive: boolean;
}

export const SUPERPOWERS: Superpower[] = [
  { name: 'Voz de marca', subtitle: 'TU BOT HABLA COMO TU NEGOCIO.', description: 'Refuerza el tono, el público y las reglas de tu Voz de Marca en todos los canales. Configurala en la sección Voz de Marca.', icon: Sparkles, isActive: true },
  { name: 'Multi-idioma', subtitle: 'RESPONDE EN EL IDIOMA DEL CLIENTE.', description: 'Detecta el idioma de cada mensaje y responde en ese mismo idioma, adaptando expresiones y formalidad.', icon: Languages, isActive: true },
  { name: 'Blindaje anti-invento', subtitle: 'NO DEJA QUE EL BOT INVENTE.', description: 'Si el bot no sabe, dice que no sabe. Cero alucinaciones, cero respuestas inventadas que pueden costar un cliente.', icon: Shield, isActive: true },
  { name: 'Vigilante', subtitle: 'DETECTA PROBLEMAS EN TIEMPO REAL.', description: 'Monitorea las conversaciones y te avisa cuando un cliente está molesto, confundido, o a punto de irse.', icon: Eye, isActive: true },
  { name: 'Cazador de ventas', subtitle: 'DETECTA OPORTUNIDADES DE VENTA.', description: 'Lee entre líneas y te avisa cuando un cliente muestra interés de compra — para que tú cierres.', icon: Target, isActive: true },
  { name: 'Cobros por WhatsApp', subtitle: 'COBRA SIN FRICCIÓN.', description: 'Genera links de pago y los envía por el chat. El cliente paga sin salir de la conversación.', icon: Receipt, isActive: true },
  { name: 'Reportes automáticos', subtitle: 'REPORTE SEMANAL SIN MOVER UN DEDO.', description: 'Cada lunes recibes un resumen: conversaciones, ventas, no-shows, tendencias. Directo a tu WhatsApp.', icon: FileBarChart, isActive: true },
  { name: 'Recordatorios inteligentes', subtitle: 'BAJA LOS NO-SHOWS A CERO.', description: 'Envía recordatorio 24h y 1h antes de cada cita. Adapta el mensaje según el historial del cliente.', icon: BellRing, isActive: true },
  { name: 'Modo seguro', subtitle: 'FILTRA CONTENIDO INAPROPIADO.', description: 'Detecta y bloquea mensajes ofensivos, spam o intentos de manipular al bot.', icon: Lock, isActive: true },
  { name: 'Analista IA', subtitle: 'ENTIENDE CADA CONVERSACIÓN.', description: 'Lee todas las conversaciones y te dice: qué quería el cliente, si quedó contento, qué objeciones hubo.', icon: Brain, isActive: true },
  { name: 'Auto-mejora', subtitle: 'EL BOT SE CORRIGE SOLO.', description: 'Detecta los huecos en el conocimiento del bot y propone correcciones. Opcional: las aplica solo.', icon: Zap, isActive: true },
  { name: 'Turbo respuesta', subtitle: 'RESPONDE EN MENOS DE 2 SEGUNDOS.', description: 'Optimiza la velocidad de respuesta del bot usando cache inteligente y priorización de mensajes.', icon: Gauge, isActive: true },
  { name: 'Seguimiento post-venta', subtitle: 'NO PIERDAS AL CLIENTE DESPUÉS.', description: 'Envía seguimiento automático después de la compra: satisfacción, reseña, próxima cita.', icon: Sword, isActive: true },
  { name: 'Alerta de emergencia', subtitle: 'AVISA CUANDO ES URGENTE.', description: 'Detecta situaciones urgentes (cliente VIP, queja grave, pedido grande) y te notifica al instante.', icon: Siren, isActive: true },
  { name: 'Encuestas de satisfaccion', subtitle: 'MIDE LA ATENCIÓN EN CADA CHARLA.', description: 'Al resolver una consulta, el bot pide una calificación del 1 al 5 para medir la satisfacción del cliente.', icon: Star, isActive: false },
  { name: 'Pide resenas Google', subtitle: 'MÁS RESEÑAS, MEJOR REPUTACIÓN.', description: 'Cuando el cliente queda conforme, el bot lo invita amablemente a dejar una reseña en Google.', icon: ThumbsUp, isActive: false },
  { name: 'Recupera no-shows', subtitle: 'RECUPERA A LOS QUE NO VINIERON.', description: 'Detecta turnos marcados como no-show y arma un mensaje para reprogramarlos automáticamente.', icon: CalendarClock, isActive: false },
  { name: 'Galería', subtitle: 'FOTOS, VIDEOS Y AUDIOS REALES.', description: 'Carga material real por URL para que el bot lo comparta en el chat y se vea en el panel.', icon: Images, isActive: false },
];
