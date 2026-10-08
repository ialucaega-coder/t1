// Script de seed (datos de demostración) para Local B.
// Crea un negocio de ejemplo con usuarios, profesionales, horarios, categorías,
// servicios, productos, clientes, reservas, pedidos, transacciones y notificaciones.
// Se ejecuta con: npx prisma db seed

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Suma/resta días a una fecha, devolviendo una copia (no muta el original)
function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Devuelve una fecha/hora relativa a hoy (para timestamps realistas de
// conversaciones y mensajes repartidos en los últimos días).
function at(base: Date, dayOffset: number, hour: number, minute = 0): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d;
}

// Elección determinística de un elemento (sin azar, para seeds reproducibles).
function pick<T>(arr: readonly T[], i: number): T {
  return arr[i % arr.length];
}

async function main() {
  console.log('Sembrando la base de datos...');

  const passwordHash = await bcrypt.hash('admin123', 12);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Se usa una única transacción interactiva para garantizar atomicidad:
  // si algo falla a mitad de camino, no queda data parcial en la base.
  await prisma.$transaction(async (tx) => {
    // ---------------------------------------------------------------------
    // Idempotencia: si ya existe el negocio demo, lo borramos (el cascade
    // elimina usuarios, bots, conversaciones, reservas, suscripción, etc.).
    // Así `db:seed` es re-ejecutable sin duplicar datos ni chocar con el
    // email único del admin.
    // ---------------------------------------------------------------------
    await tx.business.deleteMany({ where: { slug: 'studio-belleza-demo' } });

    // ---------------------------------------------------------------------
    // Negocio
    // ---------------------------------------------------------------------
    const business = await tx.business.create({
      data: {
        name: 'Studio Belleza Demo',
        slug: 'studio-belleza-demo',
        description: 'Salón de belleza y barbería de demostración',
        phone: '+54 11 5555-0000',
        email: 'demo@localb.com',
        address: 'Av. Corrientes 1234, CABA',
        city: 'Buenos Aires',
        country: 'Argentina',
        accentColor: '#38BDF8',
      },
    });

    // ---------------------------------------------------------------------
    // Usuarios: administrador + profesionales
    // ---------------------------------------------------------------------
    const admin = await tx.user.create({
      data: {
        email: 'admin@localb.com',
        passwordHash,
        name: 'Admin Demo',
        role: 'ADMIN',
        businessId: business.id,
      },
    });

    const proUsersData = [
      { email: 'ana@localb.com', name: 'Ana López', bio: 'Estilista con 10 años de experiencia', specialties: ['Corte', 'Color', 'Peinado'] },
      { email: 'carlos@localb.com', name: 'Carlos Ruiz', bio: 'Barbero especialista en cortes clásicos y modernos', specialties: ['Barba', 'Corte caballero', 'Fade'] },
      { email: 'sofia@localb.com', name: 'Sofía Torres', bio: 'Colorista y especialista en mechas', specialties: ['Color', 'Mechas', 'Tratamientos'] },
    ];

    const professionals = [];
    for (const p of proUsersData) {
      const user = await tx.user.create({
        data: {
          email: p.email,
          passwordHash,
          name: p.name,
          role: 'PROFESSIONAL',
          businessId: business.id,
        },
      });

      const professional = await tx.professional.create({
        data: {
          bio: p.bio,
          specialties: p.specialties,
          userId: user.id,
          businessId: business.id,
        },
      });

      // Horario de lunes (1) a sábado (6), de 09:00 a 18:00
      for (let day = 1; day <= 6; day++) {
        await tx.schedule.create({
          data: {
            dayOfWeek: day,
            startTime: '09:00',
            endTime: '18:00',
            professionalId: professional.id,
            businessId: business.id,
          },
        });
      }

      professionals.push(professional);
    }
    const [pro1, pro2, pro3] = professionals;

    // ---------------------------------------------------------------------
    // Categorías
    // ---------------------------------------------------------------------
    const catCortes = await tx.category.create({ data: { name: 'Cortes', businessId: business.id, sortOrder: 1 } });
    const catColor = await tx.category.create({ data: { name: 'Color', businessId: business.id, sortOrder: 2 } });
    const catBarberia = await tx.category.create({ data: { name: 'Barbería', businessId: business.id, sortOrder: 3 } });
    const catTratamientos = await tx.category.create({ data: { name: 'Tratamientos', businessId: business.id, sortOrder: 4 } });
    const catProductos = await tx.category.create({ data: { name: 'Productos', businessId: business.id, sortOrder: 5 } });

    // ---------------------------------------------------------------------
    // Servicios (8)
    // ---------------------------------------------------------------------
    const serviceDefs = [
      { name: 'Corte caballero', duration: 30, price: 5000, categoryId: catCortes.id, sortOrder: 1 },
      { name: 'Corte + Peinado', duration: 60, price: 8000, categoryId: catCortes.id, sortOrder: 2 },
      { name: 'Corte dama', duration: 45, price: 7000, categoryId: catCortes.id, sortOrder: 3 },
      { name: 'Color completo', duration: 120, price: 15000, categoryId: catColor.id, sortOrder: 4 },
      { name: 'Mechas / Highlights', duration: 150, price: 20000, categoryId: catColor.id, sortOrder: 5 },
      { name: 'Barba', duration: 20, price: 3000, categoryId: catBarberia.id, sortOrder: 6 },
      { name: 'Corte + Barba', duration: 45, price: 7000, categoryId: catBarberia.id, sortOrder: 7 },
      { name: 'Tratamiento capilar', duration: 40, price: 9000, categoryId: catTratamientos.id, sortOrder: 8 },
    ];

    const services = [];
    for (const s of serviceDefs) {
      services.push(
        await tx.service.create({
          data: { ...s, businessId: business.id },
        })
      );
    }

    // Asignación de servicios a profesionales (relación muchos a muchos)
    await tx.professional.update({ where: { id: pro1.id }, data: { services: { connect: [{ id: services[0].id }, { id: services[1].id }, { id: services[2].id }, { id: services[7].id }] } } });
    await tx.professional.update({ where: { id: pro2.id }, data: { services: { connect: [{ id: services[0].id }, { id: services[5].id }, { id: services[6].id }] } } });
    await tx.professional.update({ where: { id: pro3.id }, data: { services: { connect: [{ id: services[3].id }, { id: services[4].id }, { id: services[7].id }] } } });

    // ---------------------------------------------------------------------
    // Productos (6)
    // ---------------------------------------------------------------------
    const productDefs = [
      { name: 'Shampoo Profesional 500ml', price: 8500, stock: 24 },
      { name: 'Acondicionador Reparador', price: 7200, stock: 18 },
      { name: 'Cera para cabello', price: 4500, stock: 32 },
      { name: 'Aceite de argán', price: 6800, stock: 12 },
      { name: 'Spray fijador', price: 5200, stock: 20 },
      { name: 'Kit de tijeras profesional', price: 32000, stock: 5 },
    ];

    const products = [];
    for (const p of productDefs) {
      products.push(
        await tx.product.create({
          data: { ...p, businessId: business.id, categoryId: catProductos.id },
        })
      );
    }

    // ---------------------------------------------------------------------
    // Clientes (5)
    // ---------------------------------------------------------------------
    const clientDefs = [
      { email: 'maria@email.com', name: 'María García', phone: '+54 11 5555-0001' },
      { email: 'juan@email.com', name: 'Juan Pérez', phone: '+54 11 5555-0002' },
      { email: 'laura@email.com', name: 'Laura Méndez', phone: '+54 11 5555-0003' },
      { email: 'diego@email.com', name: 'Diego Fernández', phone: '+54 11 5555-0004' },
      { email: 'valentina@email.com', name: 'Valentina Rojas', phone: '+54 11 5555-0005' },
    ];

    const clients = [];
    for (const c of clientDefs) {
      clients.push(
        await tx.user.create({
          data: { ...c, passwordHash, role: 'CLIENT', businessId: business.id },
        })
      );
    }

    // ---------------------------------------------------------------------
    // Reservas (15) distribuidas en varios días (pasados, hoy y futuros)
    // ---------------------------------------------------------------------
    const bookingDefs = [
      { dayOffset: -3, startTime: '09:00', endTime: '10:00', status: 'COMPLETED', source: 'WEB', client: 0, pro: pro1, service: services[1] },
      { dayOffset: -3, startTime: '11:00', endTime: '11:20', status: 'COMPLETED', source: 'WALK_IN', client: 1, pro: pro2, service: services[5] },
      { dayOffset: -2, startTime: '10:00', endTime: '12:00', status: 'COMPLETED', source: 'TELEGRAM', client: 2, pro: pro3, service: services[3] },
      { dayOffset: -2, startTime: '15:00', endTime: '15:30', status: 'NO_SHOW', source: 'WEB', client: 3, pro: pro1, service: services[0] },
      { dayOffset: -1, startTime: '09:30', endTime: '10:15', status: 'COMPLETED', source: 'WHATSAPP', client: 4, pro: pro2, service: services[6] },
      { dayOffset: -1, startTime: '13:00', endTime: '13:40', status: 'COMPLETED', source: 'WEB', client: 0, pro: pro1, service: services[2] },
      { dayOffset: 0, startTime: '09:00', endTime: '10:00', status: 'CONFIRMED', source: 'WEB', client: 0, pro: pro1, service: services[1] },
      { dayOffset: 0, startTime: '10:00', endTime: '10:30', status: 'PENDING', source: 'WHATSAPP', client: 1, pro: pro2, service: services[5] },
      { dayOffset: 0, startTime: '11:00', endTime: '13:00', status: 'CONFIRMED', source: 'TELEGRAM', client: 2, pro: pro3, service: services[3] },
      { dayOffset: 0, startTime: '14:00', endTime: '14:45', status: 'PENDING', source: 'WEB', client: 3, pro: pro2, service: services[6] },
      { dayOffset: 1, startTime: '09:00', endTime: '10:30', status: 'CONFIRMED', source: 'WEB', client: 4, pro: pro3, service: services[7] },
      { dayOffset: 1, startTime: '11:00', endTime: '11:20', status: 'PENDING', source: 'VOICE', client: 1, pro: pro2, service: services[5] },
      { dayOffset: 2, startTime: '10:00', endTime: '10:45', status: 'CONFIRMED', source: 'WEB', client: 2, pro: pro1, service: services[2] },
      { dayOffset: 3, startTime: '09:00', endTime: '11:30', status: 'PENDING', source: 'TELEGRAM', client: 3, pro: pro3, service: services[4] },
      { dayOffset: 4, startTime: '16:00', endTime: '16:45', status: 'CANCELLED', source: 'WHATSAPP', client: 4, pro: pro1, service: services[1] },
    ];

    for (const b of bookingDefs) {
      await tx.booking.create({
        data: {
          date: addDays(today, b.dayOffset),
          startTime: b.startTime,
          endTime: b.endTime,
          status: b.status as any,
          source: b.source as any,
          totalPrice: b.service.price,
          clientId: clients[b.client].id,
          professionalId: b.pro.id,
          serviceId: b.service.id,
          businessId: business.id,
        },
      });
    }

    // ---------------------------------------------------------------------
    // Pedidos (10) con sus líneas de detalle y transacción de pago asociada
    // ---------------------------------------------------------------------
    const orderStatuses = ['DELIVERED', 'DELIVERED', 'DELIVERED', 'PREPARING', 'READY', 'PENDING', 'CONFIRMED', 'DELIVERED', 'CANCELLED', 'PENDING'];
    const paymentMethods = ['CASH', 'CARD', 'TRANSFER', 'QR'];

    for (let i = 0; i < 10; i++) {
      const client = clients[i % clients.length];
      const itemCount = (i % 3) + 1; // entre 1 y 3 productos por pedido
      const chosenProducts = [products[i % products.length], products[(i + 2) % products.length]].slice(0, itemCount);

      let total = 0;
      const itemsData = chosenProducts.map((prod, idx) => {
        const quantity = ((i + idx) % 3) + 1;
        const priceNum = Number(prod.price);
        total += priceNum * quantity;
        return { productId: prod.id, quantity, price: prod.price };
      });

      const order = await tx.order.create({
        data: {
          status: orderStatuses[i] as any,
          totalPrice: total,
          clientId: client.id,
          businessId: business.id,
          items: { create: itemsData },
        },
      });

      // Registra el cobro correspondiente si el pedido no fue cancelado
      if (order.status !== 'CANCELLED') {
        await tx.transaction.create({
          data: {
            amount: total,
            type: 'SALE',
            paymentMethod: paymentMethods[i % paymentMethods.length] as any,
            reference: `Pedido #${order.id.slice(-6)}`,
            businessId: business.id,
            orderId: order.id,
          },
        });
      }
    }

    // ---------------------------------------------------------------------
    // Notificaciones de ejemplo
    // ---------------------------------------------------------------------
    const notificationDefs = [
      { userId: clients[0].id, type: 'BOOKING_CONFIRMED', channel: 'WHATSAPP', title: 'Turno confirmado', body: 'Tu turno de hoy a las 09:00 fue confirmado.', isRead: false },
      { userId: clients[1].id, type: 'BOOKING_REMINDER', channel: 'EMAIL', title: 'Recordatorio de turno', body: 'Tenés un turno mañana a las 11:00.', isRead: false },
      { userId: clients[2].id, type: 'ORDER_STATUS', channel: 'PUSH', title: 'Pedido en preparación', body: 'Tu pedido está siendo preparado.', isRead: true },
      { userId: clients[3].id, type: 'PROMOTION', channel: 'TELEGRAM', title: 'Promo de la semana', body: '20% off en coloración todos los martes.', isRead: false },
      { userId: clients[4].id, type: 'BOOKING_CANCELLED', channel: 'SMS', title: 'Turno cancelado', body: 'Tu turno fue cancelado. Contactanos para reprogramar.', isRead: true },
      { userId: admin.id, type: 'GENERAL', channel: 'EMAIL', title: 'Resumen semanal', body: 'Tenés un nuevo resumen de actividad disponible.', isRead: false },
    ];

    for (const n of notificationDefs) {
      await tx.notification.create({
        data: {
          ...n,
          type: n.type as any,
          channel: n.channel as any,
          businessId: business.id,
        },
      });
    }

    // -----------------------------------------------------------------
    // Planes de suscripción
    // -----------------------------------------------------------------
    await tx.plan.createMany({
      data: [
        {
          name: 'Gratis',
          tier: 'FREE',
          priceMonthly: 0,
          priceYearly: 0,
          maxBots: 1,
          maxMessages: 500,
          maxContacts: 100,
          features: ['Webchat básico', 'Catálogo de productos'],
        },
        {
          name: 'Starter',
          tier: 'STARTER',
          priceMonthly: 29,
          priceYearly: 278,
          maxBots: 3,
          maxMessages: 5000,
          maxContacts: 1000,
          features: ['Todo de Gratis', 'WhatsApp', 'Telegram', 'Reportes básicos'],
        },
        {
          name: 'Pro',
          tier: 'PRO',
          priceMonthly: 79,
          priceYearly: 758,
          maxBots: 10,
          maxMessages: 25000,
          maxContacts: 10000,
          features: ['Todo de Starter', 'IA avanzada', 'Campañas', 'White-label', 'API access'],
        },
        {
          name: 'Enterprise',
          tier: 'ENTERPRISE',
          priceMonthly: 199,
          priceYearly: 1910,
          maxBots: 999,
          maxMessages: 999999,
          maxContacts: 999999,
          features: ['Todo de Pro', 'Bots ilimitados', 'Soporte prioritario', 'SLA 99.9%', 'Onboarding dedicado'],
        },
      ],
      skipDuplicates: true,
    });

    // -----------------------------------------------------------------
    // Suscripción del negocio demo → ENTERPRISE.
    // En el laboratorio queremos poder probar TODAS las features sin topes
    // de plan (marketing/campañas, superpoderes/tools, agencia). En un
    // negocio real este tier sale de la facturación; acá lo fijamos para el
    // escenario de prueba.
    // -----------------------------------------------------------------
    const enterprisePlan = await tx.plan.findUnique({ where: { tier: 'ENTERPRISE' } });
    if (enterprisePlan) {
      const subscription = await tx.subscription.create({
        data: {
          status: 'ACTIVE',
          currentPeriodStart: addDays(today, -15),
          currentPeriodEnd: addDays(today, 15),
          planId: enterprisePlan.id,
          businessId: business.id,
        },
      });

      // Facturas: historial de cobros del plan (para /facturacion).
      await tx.invoice.createMany({
        data: [
          {
            number: 'INV-DEMO-0001',
            status: 'PAID',
            amount: 199,
            description: 'Plan Enterprise — mes anterior',
            dueDate: addDays(today, -45),
            paidAt: addDays(today, -44),
            subscriptionId: subscription.id,
            businessId: business.id,
          },
          {
            number: 'INV-DEMO-0002',
            status: 'PAID',
            amount: 199,
            description: 'Plan Enterprise — mes en curso',
            dueDate: addDays(today, -15),
            paidAt: addDays(today, -14),
            subscriptionId: subscription.id,
            businessId: business.id,
          },
          {
            number: 'INV-DEMO-0003',
            status: 'PENDING',
            amount: 199,
            description: 'Plan Enterprise — próximo período',
            dueDate: addDays(today, 15),
            subscriptionId: subscription.id,
            businessId: business.id,
          },
        ],
      });
    }

    // -----------------------------------------------------------------
    // Bots (canales del asistente). Un WEBCHAT y un WhatsApp, ambos ACTIVE,
    // para que /bots, /ia, /conversaciones y el widget público tengan vida.
    // -----------------------------------------------------------------
    const webBot = await tx.bot.create({
      data: {
        name: 'Asistente Web — Studio Belleza',
        description: 'Bot del sitio que responde consultas y agenda turnos.',
        channel: 'WEBCHAT',
        status: 'ACTIVE',
        lastActiveAt: at(today, 0, 10, 30),
        messageCount: 0,
        businessId: business.id,
      },
    });
    const waBot = await tx.bot.create({
      data: {
        name: 'WhatsApp — Studio Belleza',
        description: 'Atención por WhatsApp con reservas y recordatorios.',
        channel: 'WHATSAPP',
        status: 'ACTIVE',
        lastActiveAt: at(today, 0, 9, 15),
        messageCount: 0,
        businessId: business.id,
      },
    });

    // -----------------------------------------------------------------
    // Conversaciones + mensajes repartidos en los últimos ~28 días.
    // Esto es lo que daba sensación de "vacío": sin conversaciones, Análisis,
    // Estadísticas y el Dashboard mostraban todo en cero. Variamos canal,
    // estado y responseTime para que los KPIs, la satisfacción y el costo de
    // IA salgan realistas.
    // -----------------------------------------------------------------
    const convChannels = ['WEBCHAT', 'WHATSAPP', 'TELEGRAM', 'WEBCHAT', 'WHATSAPP'] as const;
    const convStatuses = ['CLOSED', 'CLOSED', 'CLOSED', 'OPEN', 'HANDOFF'] as const;
    const contactNames = ['María García', 'Juan Pérez', 'Laura Méndez', 'Diego Fernández', 'Valentina Rojas', 'Lucía Benítez', 'Martín Silva', 'Carla Díaz'];
    const userTexts = [
      'Hola! Quería saber si tienen turno para corte esta semana',
      '¿Cuánto sale el color completo?',
      'Necesito cancelar mi turno de mañana',
      '¿Atienden los sábados?',
      '¿Tienen shampoo profesional en stock?',
      'Quiero reservar barba y corte para el viernes',
      '¿Dónde están ubicados?',
      '¿Puedo pagar con tarjeta?',
    ];
    const botTexts = [
      '¡Hola! Sí, tenemos disponibilidad. ¿Qué día te queda cómodo?',
      'El color completo sale $15.000 e incluye lavado y peinado.',
      'Listo, cancelé tu turno. ¿Querés reprogramar para otro día?',
      'Sí, atendemos sábados de 9 a 18 hs.',
      'Sí, tenemos shampoo profesional 500ml a $8.500. ¿Te lo reservo?',
      '¡Perfecto! Te agendo corte + barba el viernes. ¿A qué hora?',
      'Estamos en Av. Corrientes 1234, CABA.',
      'Sí, aceptamos tarjeta, efectivo, transferencia y QR.',
    ];

    let totalBotMessages = 0;
    const CONV_COUNT = 24;
    for (let i = 0; i < CONV_COUNT; i++) {
      const channel = pick(convChannels, i);
      const status = pick(convStatuses, i);
      const bot = channel === 'WHATSAPP' ? waBot : webBot;
      const dayOffset = -Math.floor((i * 28) / CONV_COUNT); // 0 .. -27, repartido
      const baseHour = 9 + (i % 9);
      const createdAt = at(today, dayOffset, baseHour, (i * 7) % 60);

      const conv = await tx.conversation.create({
        data: {
          status,
          channel,
          contactName: pick(contactNames, i),
          contactPhone: `+54 11 5555-1${String(i).padStart(3, '0')}`,
          botId: bot.id,
          businessId: business.id,
          createdAt,
          updatedAt: createdAt,
        },
      });

      // 2 a 3 pares USER/BOT por conversación.
      const pairs = 2 + (i % 2);
      const msgs: { role: 'USER' | 'BOT'; text: string; responseTime: number | null; createdAt: Date }[] = [];
      for (let p = 0; p < pairs; p++) {
        const tUser = at(today, dayOffset, baseHour, ((i * 7) % 60) + p * 4);
        const tBot = at(today, dayOffset, baseHour, ((i * 7) % 60) + p * 4 + 1);
        msgs.push({ role: 'USER', text: pick(userTexts, i + p), responseTime: null, createdAt: tUser });
        msgs.push({ role: 'BOT', text: pick(botTexts, i + p), responseTime: 900 + ((i * 53 + p * 120) % 2600), createdAt: tBot });
        totalBotMessages++;
      }
      await tx.message.createMany({
        data: msgs.map((m) => ({
          role: m.role,
          text: m.text,
          responseTime: m.responseTime,
          conversationId: conv.id,
          createdAt: m.createdAt,
        })),
      });
    }

    // Reflejamos el conteo de mensajes en los bots.
    await tx.bot.update({ where: { id: webBot.id }, data: { messageCount: Math.round(totalBotMessages * 0.6) } });
    await tx.bot.update({ where: { id: waBot.id }, data: { messageCount: Math.round(totalBotMessages * 0.4) } });

    // -----------------------------------------------------------------
    // Campañas (para /campanas, tier PRO+ ya habilitado por Enterprise).
    // -----------------------------------------------------------------
    await tx.campaign.createMany({
      data: [
        { name: 'Promo Color Martes', description: '20% off en coloración', status: 'sent', channel: 'whatsapp', sentCount: 320, openRate: 0.62, clickRate: 0.18, businessId: business.id },
        { name: 'Recordatorio temporada', description: 'Reservá tu turno de fin de año', status: 'sent', channel: 'email', sentCount: 540, openRate: 0.41, clickRate: 0.09, businessId: business.id },
        { name: 'Lanzamiento línea de productos', description: 'Nuevos productos premium', status: 'scheduled', channel: 'whatsapp', sentCount: 0, openRate: 0, clickRate: 0, scheduledAt: addDays(today, 3), businessId: business.id },
        { name: 'Encuesta de satisfacción', description: '¿Cómo fue tu experiencia?', status: 'draft', channel: 'email', sentCount: 0, openRate: 0, clickRate: 0, businessId: business.id },
      ],
    });

    // -----------------------------------------------------------------
    // Arena (builders + ideas) para /arena.
    // -----------------------------------------------------------------
    await tx.arenaBuilder.createMany({
      data: [
        { name: 'Recepcionista Pro', title: 'Agenda turnos 24/7', description: 'Bot que agenda y confirma turnos solo.', systemPrompt: 'Sos un recepcionista...', votes: 42, rank: 1, status: 'active', businessId: business.id },
        { name: 'Vendedor de productos', title: 'Sube el ticket promedio', description: 'Recomienda productos según el servicio.', systemPrompt: 'Sos un asesor de ventas...', votes: 28, rank: 2, status: 'active', businessId: business.id },
        { name: 'Recupera clientes', title: 'Reactiva inactivos', description: 'Contacta clientes que no vuelven hace 60 días.', systemPrompt: 'Sos un especialista en retención...', votes: 15, rank: 3, status: 'active', businessId: business.id },
      ],
    });
    await tx.arenaIdea.createMany({
      data: [
        { title: 'Integración con Google Calendar', description: 'Sincronizar turnos con el calendario del profesional', category: 'integraciones', votes: 33, status: 'proposed', businessId: business.id },
        { title: 'Pago de seña online', description: 'Cobrar una seña al reservar para bajar el no-show', category: 'pagos', votes: 51, status: 'proposed', businessId: business.id },
        { title: 'Programa de fidelidad', description: 'Puntos por visita canjeables por servicios', category: 'crecimiento', votes: 24, status: 'in_progress', businessId: business.id },
        { title: 'Reseñas automáticas en Google', description: 'Pedir reseña tras un turno completado', category: 'reputación', votes: 19, status: 'proposed', businessId: business.id },
      ],
    });

    // -----------------------------------------------------------------
    // Agencia (cartera de clientes revendidos) para /agencia (ENTERPRISE).
    // -----------------------------------------------------------------
    await tx.agencyClient.createMany({
      data: [
        { name: 'Peluquería Las Flores', plan: 'Pro', bots: 2, status: 'active', revenue: 79, lastActivity: addDays(today, -1), businessId: business.id },
        { name: 'Barbería El Rey', plan: 'Starter', bots: 1, status: 'active', revenue: 29, lastActivity: addDays(today, -3), businessId: business.id },
        { name: 'Spa Serenidad', plan: 'Enterprise', bots: 5, status: 'active', revenue: 199, lastActivity: addDays(today, 0), businessId: business.id },
        { name: 'Estética Bella', plan: 'Starter', bots: 1, status: 'trial', revenue: 0, lastActivity: addDays(today, -7), businessId: business.id },
        { name: 'Uñas & Co', plan: 'Free', bots: 1, status: 'churned', revenue: 0, lastActivity: addDays(today, -40), businessId: business.id },
      ],
    });

    // -----------------------------------------------------------------
    // Marketplace: catálogo global (si no existe) + instalaciones del demo.
    // -----------------------------------------------------------------
    const mkCount = await tx.marketplaceItem.count();
    if (mkCount === 0) {
      await tx.marketplaceItem.createMany({
        data: [
          { name: 'Plantilla Peluquería', description: 'Servicios, horarios y bot listos para salón.', category: 'Plantillas', rating: 4.8, reviews: 124, price: 'Gratis', author: 'Local B', icon: 'Scissors' },
          { name: 'Recordatorios inteligentes', description: 'Reduce el no-show con recordatorios automáticos.', category: 'Automatización', rating: 4.6, reviews: 88, price: 'Gratis', author: 'Local B', icon: 'Bell' },
          { name: 'Integración Google Calendar', description: 'Sincroniza turnos con Google Calendar.', category: 'Integraciones', rating: 4.5, reviews: 56, price: 'Pro', author: 'Local B', icon: 'Calendar' },
          { name: 'Reseñas en Google', description: 'Pide reseñas tras cada turno completado.', category: 'Reputación', rating: 4.7, reviews: 73, price: 'Pro', author: 'Local B', icon: 'Star' },
        ],
      });
    }
    const firstItems = await tx.marketplaceItem.findMany({ take: 2, orderBy: { createdAt: 'asc' } });
    for (const item of firstItems) {
      await tx.marketplaceInstall.create({ data: { itemId: item.id, businessId: business.id } });
    }

    console.log('Seed completado!');
    console.log(`Negocio: ${business.name} (${business.slug}) — plan ENTERPRISE`);
    console.log(`Admin: admin@localb.com / admin123`);
    console.log(`Profesionales: ${professionals.length}, Servicios: ${services.length}, Productos: ${products.length}`);
    console.log(`Clientes: ${clients.length}, Reservas: ${bookingDefs.length}, Pedidos: 10`);
    console.log(`Bots: 2 (WEBCHAT + WhatsApp activos), Conversaciones: ${CONV_COUNT} (con mensajes en 28 días)`);
    console.log(`Campañas: 4, Arena: 3 builders + 4 ideas, Agencia: 5 clientes, Facturas: 3`);
  });
}

main()
  .catch((err) => {
    console.error('Error al sembrar la base de datos:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
