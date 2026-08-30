export interface CommandItem {
  name: string;
  desc: string;
}

export interface CommandGroup {
  category: string;
  items: CommandItem[];
}

export const COMMANDS: CommandGroup[] = [
  { category: 'Reservas', items: [
    { name: '/nueva-reserva', desc: 'Crea una reserva manual desde el panel' },
    { name: '/ver-agenda', desc: 'Muestra la agenda del día o de la semana' },
    { name: '/cancelar-reserva', desc: 'Cancela una reserva existente por ID' },
    { name: '/confirmar-reserva', desc: 'Confirma una reserva pendiente' },
    { name: '/mover-reserva', desc: 'Cambia fecha u hora de una reserva' },
    { name: '/bloquear-horario', desc: 'Bloquea un rango de horas para un profesional' },
    { name: '/desbloquear-horario', desc: 'Libera un horario previamente bloqueado' },
  ]},
  { category: 'Clientes', items: [
    { name: '/buscar-cliente', desc: 'Busca un cliente por nombre, email o teléfono' },
    { name: '/historial-cliente', desc: 'Muestra el historial de reservas y compras' },
    { name: '/agregar-cliente', desc: 'Registra un cliente nuevo manualmente' },
    { name: '/nota-cliente', desc: 'Agrega una nota interna al perfil del cliente' },
  ]},
  { category: 'Productos', items: [
    { name: '/stock', desc: 'Consulta el stock actual de un producto' },
    { name: '/actualizar-precio', desc: 'Cambia el precio de un producto o servicio' },
    { name: '/agregar-producto', desc: 'Crea un producto nuevo en el catálogo' },
    { name: '/desactivar-producto', desc: 'Oculta un producto del catálogo público' },
  ]},
  { category: 'Comunicación', items: [
    { name: '/enviar-recordatorio', desc: 'Envía recordatorio manual a un cliente' },
    { name: '/enviar-promo', desc: 'Envía una promoción a la lista de clientes' },
    { name: '/broadcast', desc: 'Mensaje masivo a un segmento de clientes' },
    { name: '/respuesta-rapida', desc: 'Configura una respuesta automática predefinida' },
  ]},
  { category: 'Reportes', items: [
    { name: '/reporte-diario', desc: 'Genera el reporte del día: reservas, ventas, no-shows' },
    { name: '/reporte-semanal', desc: 'Resumen de la semana con tendencias' },
    { name: '/top-servicios', desc: 'Ranking de servicios más reservados' },
    { name: '/top-clientes', desc: 'Clientes con más reservas o compras' },
  ]},
  { category: 'Sistema', items: [
    { name: '/estado', desc: 'Estado del bot y conexiones activas' },
    { name: '/reiniciar', desc: 'Reinicia el bot sin perder configuración' },
    { name: '/version', desc: 'Muestra la versión actual del sistema' },
    { name: '/backup', desc: 'Genera un respaldo de la configuración' },
    { name: '/logs', desc: 'Muestra los últimos 50 eventos del sistema' },
  ]},
];
