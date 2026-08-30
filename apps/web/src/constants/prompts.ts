export interface Prompt {
  id: string;
  name: string;
  category: string;
  content: string;
  isActive: boolean;
}

export const MOCK_PROMPTS: Prompt[] = [
  {
    id: '1',
    name: 'Saludo inicial',
    category: 'General',
    content: 'Hola 👋 Bienvenido a {negocio}. Soy tu asistente virtual. ¿En qué te puedo ayudar?\n\n1️⃣ Agendar una cita\n2️⃣ Ver servicios y precios\n3️⃣ Consultar disponibilidad\n4️⃣ Hablar con un humano',
    isActive: true,
  },
  {
    id: '2',
    name: 'Confirmación de reserva',
    category: 'Reservas',
    content: '✅ ¡Reserva confirmada!\n\n📅 {fecha}\n⏰ {hora}\n💇 {servicio}\n👤 Con {profesional}\n\nTe enviaremos un recordatorio 24h antes. Si necesitas cancelar o mover tu cita, escríbeme.',
    isActive: true,
  },
  {
    id: '3',
    name: 'Recordatorio 24h',
    category: 'Notificaciones',
    content: '⏰ Recordatorio: mañana tienes cita en {negocio}\n\n📅 {fecha} a las {hora}\n💇 {servicio}\n\n¿Todo bien? Responde SI para confirmar o CANCELAR si no puedes asistir.',
    isActive: true,
  },
  {
    id: '4',
    name: 'Post-venta / Reseña',
    category: 'Seguimiento',
    content: 'Hola {nombre} 😊 ¿Qué tal quedó tu {servicio}? Tu opinión nos ayuda a mejorar.\n\nSi te gustó, te agradecemos un ⭐ en Google: {link_resena}',
    isActive: false,
  },
];
