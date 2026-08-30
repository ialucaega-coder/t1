import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  const passwordHash = await bcrypt.hash('admin123', 12);

  const business = await prisma.business.create({
    data: {
      name: 'Studio Belleza Demo',
      slug: 'studio-belleza-demo',
      description: 'Salón de belleza y barbería de demostración',
      phone: '+54 11 5555-0000',
      email: 'demo@localb.com',
      address: 'Av. Corrientes 1234, CABA',
      city: 'Buenos Aires',
      country: 'Argentina',
    },
  });

  const admin = await prisma.user.create({
    data: {
      email: 'admin@localb.com',
      passwordHash,
      name: 'Admin Demo',
      role: 'ADMIN',
      businessId: business.id,
    },
  });

  const proUser1 = await prisma.user.create({
    data: {
      email: 'ana@localb.com',
      passwordHash,
      name: 'Ana López',
      role: 'PROFESSIONAL',
      businessId: business.id,
    },
  });

  const proUser2 = await prisma.user.create({
    data: {
      email: 'carlos@localb.com',
      passwordHash,
      name: 'Carlos Ruiz',
      role: 'PROFESSIONAL',
      businessId: business.id,
    },
  });

  const pro1 = await prisma.professional.create({
    data: {
      bio: 'Estilista con 10 años de experiencia',
      specialties: ['Corte', 'Color', 'Peinado'],
      userId: proUser1.id,
      businessId: business.id,
    },
  });

  const pro2 = await prisma.professional.create({
    data: {
      bio: 'Barbero especialista en cortes clásicos y modernos',
      specialties: ['Barba', 'Corte caballero', 'Fade'],
      userId: proUser2.id,
      businessId: business.id,
    },
  });

  for (const pro of [pro1, pro2]) {
    for (let day = 1; day <= 6; day++) {
      await prisma.schedule.create({
        data: {
          dayOfWeek: day,
          startTime: '09:00',
          endTime: '18:00',
          professionalId: pro.id,
          businessId: business.id,
        },
      });
    }
  }

  const catCortes = await prisma.category.create({ data: { name: 'Cortes', businessId: business.id, sortOrder: 1 } });
  const catColor = await prisma.category.create({ data: { name: 'Color', businessId: business.id, sortOrder: 2 } });
  const catBarberia = await prisma.category.create({ data: { name: 'Barbería', businessId: business.id, sortOrder: 3 } });
  const catProductos = await prisma.category.create({ data: { name: 'Productos', businessId: business.id, sortOrder: 4 } });

  const services = await Promise.all([
    prisma.service.create({ data: { name: 'Corte caballero', duration: 30, price: 5000, businessId: business.id, categoryId: catCortes.id, sortOrder: 1 } }),
    prisma.service.create({ data: { name: 'Corte + Peinado', duration: 60, price: 8000, businessId: business.id, categoryId: catCortes.id, sortOrder: 2 } }),
    prisma.service.create({ data: { name: 'Color completo', duration: 120, price: 15000, businessId: business.id, categoryId: catColor.id, sortOrder: 3 } }),
    prisma.service.create({ data: { name: 'Mechas / Highlights', duration: 150, price: 20000, businessId: business.id, categoryId: catColor.id, sortOrder: 4 } }),
    prisma.service.create({ data: { name: 'Barba', duration: 20, price: 3000, businessId: business.id, categoryId: catBarberia.id, sortOrder: 5 } }),
    prisma.service.create({ data: { name: 'Corte + Barba', duration: 45, price: 7000, businessId: business.id, categoryId: catBarberia.id, sortOrder: 6 } }),
  ]);

  await Promise.all([
    prisma.product.create({ data: { name: 'Shampoo Profesional 500ml', price: 8500, stock: 24, businessId: business.id, categoryId: catProductos.id } }),
    prisma.product.create({ data: { name: 'Acondicionador Reparador', price: 7200, stock: 18, businessId: business.id, categoryId: catProductos.id } }),
    prisma.product.create({ data: { name: 'Cera para cabello', price: 4500, stock: 32, businessId: business.id, categoryId: catProductos.id } }),
    prisma.product.create({ data: { name: 'Aceite de argán', price: 6800, stock: 12, businessId: business.id, categoryId: catProductos.id } }),
  ]);

  const clients = await Promise.all([
    prisma.user.create({ data: { email: 'maria@email.com', passwordHash, name: 'María García', phone: '+54 11 5555-0001', role: 'CLIENT', businessId: business.id } }),
    prisma.user.create({ data: { email: 'juan@email.com', passwordHash, name: 'Juan Pérez', phone: '+54 11 5555-0002', role: 'CLIENT', businessId: business.id } }),
    prisma.user.create({ data: { email: 'laura@email.com', passwordHash, name: 'Laura Méndez', phone: '+54 11 5555-0003', role: 'CLIENT', businessId: business.id } }),
  ]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  await Promise.all([
    prisma.booking.create({ data: { date: today, startTime: '09:00', endTime: '10:00', status: 'CONFIRMED', source: 'WEB', totalPrice: 8000, clientId: clients[0].id, professionalId: pro1.id, serviceId: services[1].id, businessId: business.id } }),
    prisma.booking.create({ data: { date: today, startTime: '10:00', endTime: '10:30', status: 'PENDING', source: 'WHATSAPP', totalPrice: 3000, clientId: clients[1].id, professionalId: pro2.id, serviceId: services[4].id, businessId: business.id } }),
    prisma.booking.create({ data: { date: today, startTime: '11:00', endTime: '13:00', status: 'CONFIRMED', source: 'TELEGRAM', totalPrice: 15000, clientId: clients[2].id, professionalId: pro1.id, serviceId: services[2].id, businessId: business.id } }),
    prisma.booking.create({ data: { date: today, startTime: '14:00', endTime: '14:45', status: 'PENDING', source: 'WEB', totalPrice: 7000, clientId: clients[0].id, professionalId: pro2.id, serviceId: services[5].id, businessId: business.id } }),
  ]);

  console.log('Seed completed!');
  console.log(`Business: ${business.name} (${business.slug})`);
  console.log(`Admin: admin@localb.com / admin123`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
