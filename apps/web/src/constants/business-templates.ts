export interface BusinessTemplate {
  name: string;
  description: string;
}

export const BUSINESS_TEMPLATES: BusinessTemplate[] = [
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
  { name: 'Taller mecánico', description: 'Turnos, presupuestos, seguimiento de reparación y aviso cuando está listo.' },
];
