export const DEFAULT_COMMAND_GROUPS = [
  {
    category: 'Reservas',
    items: [
      { name: '/nueva-reserva', desc: 'Crea una reserva manual desde el panel' },
      { name: '/ver-agenda', desc: 'Muestra la agenda del dia o de la semana' },
      { name: '/cancelar-reserva', desc: 'Cancela una reserva existente por ID' },
      { name: '/confirmar-reserva', desc: 'Confirma una reserva pendiente' },
      { name: '/mover-reserva', desc: 'Cambia fecha u hora de una reserva' },
      { name: '/bloquear-horario', desc: 'Bloquea un rango de horas para un profesional' },
      { name: '/desbloquear-horario', desc: 'Libera un horario previamente bloqueado' },
    ],
  },
  {
    category: 'Clientes',
    items: [
      { name: '/buscar-cliente', desc: 'Busca un cliente por nombre, email o telefono' },
      { name: '/historial-cliente', desc: 'Muestra el historial de reservas y compras' },
      { name: '/agregar-cliente', desc: 'Registra un cliente nuevo manualmente' },
      { name: '/nota-cliente', desc: 'Agrega una nota interna al perfil del cliente' },
    ],
  },
  {
    category: 'Productos',
    items: [
      { name: '/stock', desc: 'Consulta el stock actual de un producto' },
      { name: '/actualizar-precio', desc: 'Cambia el precio de un producto o servicio' },
      { name: '/agregar-producto', desc: 'Crea un producto nuevo en el catalogo' },
      { name: '/desactivar-producto', desc: 'Oculta un producto del catalogo publico' },
    ],
  },
  {
    category: 'Comunicacion',
    items: [
      { name: '/enviar-recordatorio', desc: 'Envia recordatorio manual a un cliente' },
      { name: '/enviar-promo', desc: 'Envia una promocion a la lista de clientes' },
      { name: '/broadcast', desc: 'Mensaje masivo a un segmento de clientes' },
      { name: '/respuesta-rapida', desc: 'Configura una respuesta automatica predefinida' },
    ],
  },
  {
    category: 'Reportes',
    items: [
      { name: '/reporte-diario', desc: 'Genera el reporte del dia: reservas, ventas, no-shows' },
      { name: '/reporte-semanal', desc: 'Resumen de la semana con tendencias' },
      { name: '/top-servicios', desc: 'Ranking de servicios mas reservados' },
      { name: '/top-clientes', desc: 'Clientes con mas reservas o compras' },
    ],
  },
  {
    category: 'Sistema',
    items: [
      { name: '/estado', desc: 'Estado del bot y conexiones activas' },
      { name: '/reiniciar', desc: 'Reinicia el bot sin perder configuracion' },
      { name: '/version', desc: 'Muestra la version actual del sistema' },
      { name: '/backup', desc: 'Genera un respaldo de la configuracion' },
      { name: '/logs', desc: 'Muestra los ultimos 50 eventos del sistema' },
    ],
  },
] as const;

export const DEFAULT_PROMPTS = [
  {
    name: 'Saludo inicial',
    category: 'General',
    content:
      'Hola, bienvenido a {negocio}. Soy tu asistente virtual. En que te puedo ayudar?\n\n1. Agendar una cita\n2. Ver servicios y precios\n3. Consultar disponibilidad\n4. Hablar con un humano',
    isActive: true,
  },
  {
    name: 'Confirmacion de reserva',
    category: 'Reservas',
    content:
      'Reserva confirmada.\n\nFecha: {fecha}\nHora: {hora}\nServicio: {servicio}\nProfesional: {profesional}\n\nTe enviaremos un recordatorio 24h antes.',
    isActive: true,
  },
  {
    name: 'Recordatorio 24h',
    category: 'Notificaciones',
    content:
      'Recordatorio: manana tienes cita en {negocio}.\n\nFecha: {fecha} a las {hora}\nServicio: {servicio}\n\nResponde SI para confirmar o CANCELAR si no puedes asistir.',
    isActive: true,
  },
  {
    name: 'Post-venta / Resena',
    category: 'Seguimiento',
    content:
      'Hola {nombre}. Que tal quedo tu {servicio}? Tu opinion nos ayuda a mejorar. Si te gusto, te agradecemos una resena en Google: {link_resena}',
    isActive: false,
  },
] as const;

export const DEFAULT_SKILLS = [
  {
    name: 'Reservas inteligentes',
    subtitle: 'AGENDA AUTOMATICA POR CHAT',
    description:
      'Tus clientes reservan por WhatsApp, Telegram o web. El bot muestra horarios disponibles, confirma y envia recordatorio.',
    iconName: 'Calendar',
    isActive: true,
  },
  {
    name: 'Catalogo & Pedidos',
    subtitle: 'VENDE DESDE EL CHAT',
    description:
      'Muestra tus productos con fotos y precios. El cliente elige, arma su pedido y tu recibes la orden lista.',
    iconName: 'ShoppingBag',
    isActive: true,
  },
  {
    name: 'Cobros por WhatsApp',
    subtitle: 'ENVIA LINKS DE PAGO',
    description: 'Genera links de cobro y envialos directo por el chat. Sin pasarela, sin fricciones.',
    iconName: 'CreditCard',
    isActive: true,
  },
  {
    name: 'Recordatorios',
    subtitle: 'BAJA LOS NO-SHOWS',
    description: 'Envia recordatorio automatico 24h y 1h antes de cada cita.',
    iconName: 'Bell',
    isActive: true,
  },
  {
    name: 'Atencion por voz',
    subtitle: 'RESPONDE LLAMADAS CON IA',
    description: 'Tu bot atiende llamadas, entiende lo que dicen y agenda o toma pedidos por telefono. 24/7.',
    iconName: 'Mic',
    isActive: true,
  },
  {
    name: 'Multi-canal',
    subtitle: 'WHATSAPP + TELEGRAM + WEB',
    description: 'Un solo panel para todos tus canales. Las conversaciones se centralizan y las metricas se cruzan.',
    iconName: 'MessageCircle',
    isActive: true,
  },
  {
    name: 'Reportes automaticos',
    subtitle: 'METRICAS SIN ABRIR EXCEL',
    description: 'Cada lunes recibes un reporte con reservas, ventas, no-shows y crecimiento.',
    iconName: 'BarChart3',
    isActive: true,
  },
  {
    name: 'Superpoderes',
    subtitle: 'BLINDAJE + VIGILANTE + MAS',
    description: 'Protege tu bot contra inventos, detecta oportunidades de venta y automatiza el seguimiento.',
    iconName: 'Zap',
    isActive: true,
  },
] as const;

export const DEFAULT_SUPERPOWERS = [
  {
    name: 'Voz de marca',
    subtitle: 'TU BOT HABLA COMO TU NEGOCIO.',
    description: 'Refuerza el tono, el público y las reglas de tu Voz de Marca en todos los canales. Configurala en la sección Voz de Marca.',
    iconName: 'Sparkles',
    isActive: true,
  },
  {
    name: 'Multi-idioma',
    subtitle: 'RESPONDE EN EL IDIOMA DEL CLIENTE.',
    description: 'Detecta el idioma de cada mensaje y responde en ese mismo idioma, adaptando expresiones y formalidad.',
    iconName: 'Languages',
    isActive: true,
  },
  {
    name: 'Blindaje anti-invento',
    subtitle: 'NO DEJA QUE EL BOT INVENTE.',
    description: 'Si el bot no sabe, dice que no sabe. Cero respuestas inventadas que pueden costar un cliente.',
    iconName: 'Shield',
    isActive: true,
  },
  {
    name: 'Vigilante',
    subtitle: 'DETECTA PROBLEMAS EN TIEMPO REAL.',
    description: 'Monitorea conversaciones y avisa cuando un cliente esta molesto, confundido o por irse.',
    iconName: 'Eye',
    isActive: true,
  },
  {
    name: 'Cazador de ventas',
    subtitle: 'DETECTA OPORTUNIDADES DE VENTA.',
    description: 'Lee entre lineas y avisa cuando un cliente muestra interes de compra.',
    iconName: 'Target',
    isActive: true,
  },
  {
    name: 'Cobros por WhatsApp',
    subtitle: 'COBRA SIN FRICCION.',
    description: 'Genera links de pago y los envia por el chat.',
    iconName: 'Receipt',
    isActive: true,
  },
  {
    name: 'Reportes automaticos',
    subtitle: 'REPORTE SEMANAL SIN MOVER UN DEDO.',
    description: 'Cada lunes recibes un resumen de conversaciones, ventas, no-shows y tendencias.',
    iconName: 'FileBarChart',
    isActive: true,
  },
  {
    name: 'Recordatorios inteligentes',
    subtitle: 'BAJA LOS NO-SHOWS A CERO.',
    description: 'Envia recordatorios 24h y 1h antes de cada cita y adapta el mensaje segun historial.',
    iconName: 'BellRing',
    isActive: true,
  },
  {
    name: 'Turbo respuesta',
    subtitle: 'RESPUESTAS CORTAS Y AL GRANO.',
    description: 'El bot responde en 2-3 oraciones, directo a lo que el cliente necesita, sin relleno.',
    iconName: 'Gauge',
    isActive: false,
  },
  {
    name: 'Modo seguro',
    subtitle: 'FILTRA CONTENIDO INAPROPIADO.',
    description: 'Detecta y bloquea mensajes ofensivos, spam o intentos de manipular al bot.',
    iconName: 'Lock',
    isActive: true,
  },
  {
    name: 'Analista IA',
    subtitle: 'ENTIENDE CADA CONVERSACION.',
    description: 'Lee conversaciones y resume intencion, satisfaccion y objeciones.',
    iconName: 'Brain',
    isActive: true,
  },
  {
    name: 'Alerta de emergencia',
    subtitle: 'AVISA CUANDO ES URGENTE.',
    description: 'Detecta situaciones urgentes (queja grave, cliente VIP, pedido grande o amenaza de irse) y notifica al instante al dueno.',
    iconName: 'Siren',
    isActive: false,
  },
  {
    name: 'Seguimiento post-venta',
    subtitle: 'NO PIERDAS AL CLIENTE DESPUES.',
    description: 'Arma mensajes de seguimiento para los turnos completados y te avisa para agradecer e invitar a la proxima cita.',
    iconName: 'Sword',
    isActive: false,
  },
  {
    name: 'Auto-mejora',
    subtitle: 'EL BOT SE CORRIGE SOLO.',
    description: 'Detecta los huecos de conocimiento del bot (derivaciones y respuestas sin datos) y sugiere que agregar al Prompt/FAQ.',
    iconName: 'Zap',
    isActive: false,
  },
  {
    name: 'Encuestas de satisfaccion',
    subtitle: 'MIDE LA ATENCION EN CADA CHARLA.',
    description: 'Al resolver una consulta, el bot pide una calificacion del 1 al 5 para medir la satisfaccion del cliente.',
    iconName: 'Star',
    isActive: false,
  },
  {
    name: 'Pide resenas Google',
    subtitle: 'MAS RESENAS, MEJOR REPUTACION.',
    description: 'Cuando el cliente queda conforme, el bot lo invita amablemente a dejar una resena en Google.',
    iconName: 'ThumbsUp',
    isActive: false,
  },
  {
    name: 'Recupera no-shows',
    subtitle: 'RECUPERA A LOS QUE NO VINIERON.',
    description: 'Detecta turnos marcados como no-show y arma un mensaje para reprogramarlos automaticamente.',
    iconName: 'CalendarClock',
    isActive: false,
  },
  {
    name: 'Galería',
    subtitle: 'FOTOS, VIDEOS Y AUDIOS REALES.',
    description: 'Carga material real por URL para que el bot lo comparta en el chat y se vea en el panel.',
    iconName: 'Images',
    isActive: false,
  },
  {
    name: 'Oído y vista',
    subtitle: 'ENTIENDE LAS FOTOS QUE LE MANDAN.',
    description: 'El bot analiza las imagenes que el cliente adjunta y transcribe sus notas de voz (Whisper), respondiendo sobre lo que ve y escucha.',
    iconName: 'Eye',
    isActive: false,
  },
] as const;
