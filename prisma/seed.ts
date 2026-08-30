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

async function main() {
  console.log('Sembrando la base de datos...');

  const passwordHash = await bcrypt.hash('admin123', 12);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Se usa una única transacción interactiva para garantizar atomicidad:
  // si algo falla a mitad de camino, no queda data parcial en la base.
  await prisma.$transaction(async (tx) => {
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

    console.log('Seed completado!');
    console.log(`Negocio: ${business.name} (${business.slug})`);
    console.log(`Admin: admin@localb.com / admin123`);
    console.log(`Profesionales: ${professionals.length}, Servicios: ${services.length}, Productos: ${products.length}`);
    console.log(`Clientes: ${clients.length}, Reservas: ${bookingDefs.length}, Pedidos: 10`);
  });
}

main()
  .catch((err) => {
    console.error('Error al sembrar la base de datos:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
