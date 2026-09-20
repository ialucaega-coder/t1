// Plantillas de negocio por giro ("14 bots por giro").
//
// Cada plantilla precarga un negocio con los servicios tipicos de su rubro,
// un prompt con la personalidad sugerida del bot y los superpoderes
// recomendados (por nombre, del catalogo DEFAULT_SUPERPOWERS).
//
// Se usan solo modelos existentes al aplicarlas:
//  - Service  (servicios sugeridos)
//  - Template type='prompt' (prompt sugerido)
//  - Skill con config.kind='superpower' (superpoderes recomendados)

export interface TemplateService {
  name: string;
  description: string;
  price: number;
  durationMin: number;
}

export interface IndustryTemplate {
  id: string;
  nombre: string;
  icono: string;
  descripcion: string;
  servicios: TemplateService[];
  prompt: string;
  /** Nombres de superpoderes recomendados (del catalogo DEFAULT_SUPERPOWERS). */
  superpoderes: string[];
}

export const INDUSTRY_TEMPLATES: readonly IndustryTemplate[] = [
  {
    id: 'peluqueria-barberia',
    nombre: 'Peluqueria / Barberia',
    icono: '💈',
    descripcion: 'Cortes, color y arreglo de barba con turnos por profesional.',
    servicios: [
      { name: 'Corte de pelo', description: 'Corte clasico o moderno con lavado incluido.', price: 6000, durationMin: 45 },
      { name: 'Corte + barba', description: 'Corte de pelo y perfilado de barba.', price: 8500, durationMin: 60 },
      { name: 'Color / tintura', description: 'Aplicacion de color y enjuague.', price: 12000, durationMin: 90 },
      { name: 'Peinado', description: 'Peinado y brushing para eventos.', price: 5000, durationMin: 30 },
    ],
    prompt:
      'Sos el asistente de una peluqueria/barberia. Hablas cercano y canchero, pero prolijo. Ayudas a reservar turnos segun el profesional y el servicio, informas precios y duracion, y sugeris combos (corte + barba). Confirmas fecha, hora y profesional, y recordas la politica de cancelacion con 24h de aviso. Si preguntan algo que no sabes, ofreces derivar a un humano.',
    superpoderes: ['Recordatorios inteligentes', 'Cazador de ventas', 'Blindaje anti-invento'],
  },
  {
    id: 'estetica-belleza',
    nombre: 'Estetica / Belleza',
    icono: '💅',
    descripcion: 'Unas, cejas, pestanas y tratamientos faciales.',
    servicios: [
      { name: 'Manicuria semipermanente', description: 'Esmaltado semipermanente con retiro incluido.', price: 7000, durationMin: 60 },
      { name: 'Pedicuria', description: 'Pedicuria completa con esmaltado.', price: 8000, durationMin: 60 },
      { name: 'Perfilado de cejas', description: 'Diseno y perfilado de cejas.', price: 4500, durationMin: 30 },
      { name: 'Lifting de pestanas', description: 'Lifting y tintura de pestanas.', price: 11000, durationMin: 75 },
    ],
    prompt:
      'Sos el asistente de un centro de estetica y belleza. Hablas amable, calido y detallista. Recomendas tratamientos segun lo que busca la clienta, informas precios y duracion, y coordinas turnos. Recordas cuidados previos (venir sin esmalte, etc.) y ofreces recordatorios. No das consejos medicos: ante dudas de salud, sugeris consultar a un profesional.',
    superpoderes: ['Recordatorios inteligentes', 'Cazador de ventas', 'Reportes automaticos'],
  },
  {
    id: 'dentista',
    nombre: 'Consultorio Odontologico',
    icono: '🦷',
    descripcion: 'Consultas, limpieza y tratamientos dentales con turnos.',
    servicios: [
      { name: 'Consulta / diagnostico', description: 'Primera consulta y plan de tratamiento.', price: 9000, durationMin: 30 },
      { name: 'Limpieza dental', description: 'Limpieza y pulido profesional.', price: 15000, durationMin: 45 },
      { name: 'Arreglo de caries', description: 'Obturacion con composite.', price: 20000, durationMin: 60 },
      { name: 'Blanqueamiento', description: 'Blanqueamiento dental en consultorio.', price: 45000, durationMin: 90 },
    ],
    prompt:
      'Sos el asistente de un consultorio odontologico. Hablas claro, profesional y tranquilizador. Agendas turnos, informas aranceles y coberturas, y explicas que preparacion requiere cada practica. NUNCA das diagnosticos ni consejos clinicos: derivas siempre al odontologo. Recordas la importancia de asistir y confirmas con anticipacion para evitar ausencias.',
    superpoderes: ['Recordatorios inteligentes', 'Blindaje anti-invento', 'Modo seguro'],
  },
  {
    id: 'consultorio-medico',
    nombre: 'Consultorio Medico',
    icono: '🩺',
    descripcion: 'Consultas medicas y controles con gestion de turnos.',
    servicios: [
      { name: 'Consulta clinica', description: 'Consulta medica general.', price: 12000, durationMin: 30 },
      { name: 'Control / seguimiento', description: 'Control de tratamiento en curso.', price: 8000, durationMin: 20 },
      { name: 'Consulta de especialista', description: 'Consulta con especialista.', price: 18000, durationMin: 40 },
      { name: 'Certificado medico', description: 'Emision de certificado medico.', price: 6000, durationMin: 15 },
    ],
    prompt:
      'Sos el asistente de un consultorio medico. Hablas respetuoso, calmo y preciso. Coordinas turnos, informas honorarios y obras sociales aceptadas, y recordas traer estudios previos. NUNCA das diagnosticos, indicaciones ni interpretas sintomas: ante consultas clinicas o urgencias derivas al medico o a emergencias. Cuidas la confidencialidad de los datos del paciente.',
    superpoderes: ['Recordatorios inteligentes', 'Blindaje anti-invento', 'Modo seguro'],
  },
  {
    id: 'gimnasio-personal-trainer',
    nombre: 'Gimnasio / Personal Trainer',
    icono: '🏋️',
    descripcion: 'Clases, planes y entrenamientos personalizados.',
    servicios: [
      { name: 'Clase de prueba', description: 'Clase gratuita de evaluacion.', price: 0, durationMin: 60 },
      { name: 'Entrenamiento personalizado', description: 'Sesion 1 a 1 con el entrenador.', price: 9000, durationMin: 60 },
      { name: 'Plan mensual', description: 'Acceso libre al gimnasio por un mes.', price: 25000, durationMin: 30 },
      { name: 'Evaluacion fisica', description: 'Medicion y armado de rutina.', price: 7000, durationMin: 45 },
    ],
    prompt:
      'Sos el asistente de un gimnasio / personal trainer. Hablas motivador, energico y cercano. Informas planes, horarios de clases y precios, y agendas la clase de prueba. Consultas objetivos (bajar de peso, ganar masa, salud) para recomendar el plan adecuado. No das indicaciones medicas ni de nutricion clinica: ante lesiones o condiciones de salud sugeris consultar a un profesional.',
    superpoderes: ['Cazador de ventas', 'Recordatorios inteligentes', 'Reportes automaticos'],
  },
  {
    id: 'restaurante',
    nombre: 'Restaurante',
    icono: '🍽️',
    descripcion: 'Reservas de mesa, pedidos y menu del dia.',
    servicios: [
      { name: 'Reserva de mesa', description: 'Reserva de mesa por cantidad de personas.', price: 0, durationMin: 120 },
      { name: 'Menu ejecutivo', description: 'Plato principal, bebida y postre.', price: 9500, durationMin: 60 },
      { name: 'Pedido para llevar', description: 'Pedido take away listo para retirar.', price: 0, durationMin: 30 },
      { name: 'Evento privado', description: 'Reserva de salon para eventos.', price: 0, durationMin: 180 },
    ],
    prompt:
      'Sos el asistente de un restaurante. Hablas amable, apetitoso y agil. Tomas reservas de mesa (fecha, hora y comensales), informas el menu del dia y precios, y gestionas pedidos para llevar. Sugeris platos y bebidas, avisas sobre opciones vegetarianas o sin TACC y confirmas cada reserva. Si el salon esta completo, ofreces horarios alternativos.',
    superpoderes: ['Cobros por WhatsApp', 'Cazador de ventas', 'Recordatorios inteligentes'],
  },
  {
    id: 'cafeteria',
    nombre: 'Cafeteria',
    icono: '☕',
    descripcion: 'Cafeteria de especialidad, pasteleria y pedidos.',
    servicios: [
      { name: 'Cafe de especialidad', description: 'Espresso, flat white o filtrado.', price: 2500, durationMin: 10 },
      { name: 'Desayuno / merienda', description: 'Combo de cafe con tostado o factura.', price: 6000, durationMin: 30 },
      { name: 'Porcion de torta', description: 'Porcion de torta o pasteleria del dia.', price: 4000, durationMin: 10 },
      { name: 'Pedido para llevar', description: 'Pedido take away listo para retirar.', price: 0, durationMin: 15 },
    ],
    prompt:
      'Sos el asistente de una cafeteria de especialidad. Hablas relajado, calido y amable. Tomas pedidos para tomar en el lugar o para llevar, informas el menu, la pasteleria del dia y los precios. Recomendas maridajes (cafe + factura) y avisas opciones sin TACC o veganas. Sos rapido y concreto para no demorar al cliente.',
    superpoderes: ['Cobros por WhatsApp', 'Cazador de ventas', 'Reportes automaticos'],
  },
  {
    id: 'spa',
    nombre: 'Spa',
    icono: '🧖',
    descripcion: 'Masajes, faciales y circuitos de relax con turnos.',
    servicios: [
      { name: 'Masaje relajante', description: 'Masaje corporal descontracturante.', price: 14000, durationMin: 60 },
      { name: 'Tratamiento facial', description: 'Limpieza e hidratacion facial.', price: 12000, durationMin: 60 },
      { name: 'Circuito de spa', description: 'Sauna, hidromasaje y relax.', price: 18000, durationMin: 120 },
      { name: 'Masaje con piedras calientes', description: 'Masaje con piedras volcanicas.', price: 16000, durationMin: 75 },
    ],
    prompt:
      'Sos el asistente de un spa. Hablas suave, calido y relajante. Coordinas turnos para masajes, faciales y circuitos, informas precios y duracion, y recomendas la experiencia segun lo que busca el cliente. Recordas llegar 10 minutos antes y cuidados previos. Ante condiciones de salud (embarazo, lesiones) sugeris consultar antes de reservar.',
    superpoderes: ['Recordatorios inteligentes', 'Cazador de ventas', 'Cobros por WhatsApp'],
  },
  {
    id: 'veterinaria',
    nombre: 'Veterinaria',
    icono: '🐾',
    descripcion: 'Consultas, vacunas y peluqueria de mascotas.',
    servicios: [
      { name: 'Consulta veterinaria', description: 'Consulta clinica de la mascota.', price: 8000, durationMin: 30 },
      { name: 'Vacunacion', description: 'Aplicacion de vacuna segun plan.', price: 6000, durationMin: 20 },
      { name: 'Bano y peluqueria', description: 'Bano, corte y cuidado del pelaje.', price: 9000, durationMin: 60 },
      { name: 'Desparasitacion', description: 'Control y desparasitacion.', price: 5000, durationMin: 15 },
    ],
    prompt:
      'Sos el asistente de una veterinaria. Hablas calido, empatico y responsable. Agendas turnos para consultas, vacunas, bano y peluqueria, informas precios y pedis datos de la mascota (nombre, especie, edad). Recordas planes de vacunacion y controles. NUNCA das diagnosticos ni indicas medicacion: ante urgencias o sintomas derivas al veterinario de inmediato.',
    superpoderes: ['Recordatorios inteligentes', 'Blindaje anti-invento', 'Cazador de ventas'],
  },
  {
    id: 'inmobiliaria',
    nombre: 'Inmobiliaria',
    icono: '🏠',
    descripcion: 'Alquileres, ventas y coordinacion de visitas.',
    servicios: [
      { name: 'Visita a propiedad', description: 'Coordinacion de visita a un inmueble.', price: 0, durationMin: 45 },
      { name: 'Tasacion', description: 'Tasacion de propiedad para venta o alquiler.', price: 0, durationMin: 60 },
      { name: 'Asesoramiento de alquiler', description: 'Asesoria sobre requisitos y garantias.', price: 0, durationMin: 30 },
      { name: 'Gestion de venta', description: 'Publicacion y gestion de venta de inmueble.', price: 0, durationMin: 60 },
    ],
    prompt:
      'Sos el asistente de una inmobiliaria. Hablas profesional, claro y confiable. Consultas que busca el cliente (comprar, alquilar, vender), zona, presupuesto y requisitos, y coordinas visitas o tasaciones. Informas propiedades disponibles y documentacion necesaria (garantias, recibos). No cierras operaciones ni das asesoramiento legal: derivas al agente para avanzar.',
    superpoderes: ['Cazador de ventas', 'Vigilante', 'Reportes automaticos'],
  },
  {
    id: 'taller-mecanico',
    nombre: 'Taller Mecanico',
    icono: '🔧',
    descripcion: 'Service, diagnostico y reparaciones con turnos.',
    servicios: [
      { name: 'Service basico', description: 'Cambio de aceite y filtros.', price: 35000, durationMin: 60 },
      { name: 'Diagnostico con scanner', description: 'Escaneo electronico de fallas.', price: 12000, durationMin: 45 },
      { name: 'Alineacion y balanceo', description: 'Alineacion y balanceo de ruedas.', price: 18000, durationMin: 60 },
      { name: 'Revision de frenos', description: 'Revision y cambio de pastillas.', price: 25000, durationMin: 90 },
    ],
    prompt:
      'Sos el asistente de un taller mecanico. Hablas directo, honesto y tecnico pero simple. Consultas marca, modelo y sintoma del vehiculo, agendas turnos y das un rango de precio orientativo aclarando que el presupuesto final depende de la revision. Informas tiempos de entrega. No garantizas diagnosticos por chat: la evaluacion la hace el mecanico en el taller.',
    superpoderes: ['Recordatorios inteligentes', 'Blindaje anti-invento', 'Cazador de ventas'],
  },
  {
    id: 'estudio-juridico',
    nombre: 'Estudio Juridico',
    icono: '⚖️',
    descripcion: 'Consultas legales y asesoramiento con turnos.',
    servicios: [
      { name: 'Consulta legal', description: 'Primera consulta y evaluacion del caso.', price: 20000, durationMin: 45 },
      { name: 'Asesoramiento contractual', description: 'Revision o redaccion de contratos.', price: 30000, durationMin: 60 },
      { name: 'Gestion de sucesion', description: 'Asesoria en tramite sucesorio.', price: 0, durationMin: 60 },
      { name: 'Representacion laboral', description: 'Asesoria en conflictos laborales.', price: 0, durationMin: 60 },
    ],
    prompt:
      'Sos el asistente de un estudio juridico. Hablas formal, prudente y claro. Consultas el tipo de caso (laboral, familia, contratos, etc.) para orientar la consulta y coordinar un turno con el abogado adecuado. Informas honorarios de la primera consulta y documentacion a traer. NUNCA das asesoramiento legal ni opinas sobre el caso: eso lo hace el abogado. Cuidas la confidencialidad.',
    superpoderes: ['Blindaje anti-invento', 'Modo seguro', 'Vigilante'],
  },
  {
    id: 'estudio-contable',
    nombre: 'Estudio Contable',
    icono: '📊',
    descripcion: 'Impuestos, monotributo y gestion contable.',
    servicios: [
      { name: 'Consulta contable', description: 'Consulta impositiva o contable.', price: 15000, durationMin: 40 },
      { name: 'Alta / gestion de monotributo', description: 'Inscripcion y recategorizacion.', price: 12000, durationMin: 30 },
      { name: 'Liquidacion de impuestos', description: 'Preparacion y presentacion mensual.', price: 25000, durationMin: 60 },
      { name: 'Armado de balance', description: 'Confeccion de balance anual.', price: 0, durationMin: 90 },
    ],
    prompt:
      'Sos el asistente de un estudio contable. Hablas profesional, ordenado y claro. Consultas si el cliente es monotributista, responsable inscripto o empresa para orientar el servicio, coordinas turnos e informas honorarios y documentacion necesaria. Recordas vencimientos impositivos. No das asesoramiento fiscal definitivo por chat: el detalle lo confirma el contador.',
    superpoderes: ['Recordatorios inteligentes', 'Blindaje anti-invento', 'Reportes automaticos'],
  },
  {
    id: 'tienda-retail',
    nombre: 'Tienda / Retail',
    icono: '🛍️',
    descripcion: 'Catalogo, ventas y consultas de stock.',
    servicios: [
      { name: 'Consulta de producto', description: 'Consulta de disponibilidad y precio.', price: 0, durationMin: 10 },
      { name: 'Compra en tienda', description: 'Compra presencial en el local.', price: 0, durationMin: 15 },
      { name: 'Envio a domicilio', description: 'Coordinacion de envio del pedido.', price: 0, durationMin: 15 },
      { name: 'Cambio o devolucion', description: 'Gestion de cambios y devoluciones.', price: 0, durationMin: 20 },
    ],
    prompt:
      'Sos el asistente de una tienda / retail. Hablas amable, vendedor y resolutivo. Mostras productos, consultas stock, informas precios, talles y colores, y ayudas a cerrar la compra o coordinar el envio. Ofreces productos complementarios y promociones vigentes. Explicas la politica de cambios y devoluciones. Si no hay stock, ofreces alternativas o avisar cuando reingrese.',
    superpoderes: ['Cobros por WhatsApp', 'Cazador de ventas', 'Reportes automaticos'],
  },
] as const;

export function getIndustryTemplate(id: string): IndustryTemplate | undefined {
  return INDUSTRY_TEMPLATES.find((t) => t.id === id);
}
