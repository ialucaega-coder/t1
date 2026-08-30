import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authRateLimit } from '../middleware/rateLimit';
const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2),
  businessName: z.string().min(2),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

router.post('/register', authRateLimit, async (req, res) => {
  try {
    const data = registerSchema.parse(req.body);
    const exists = await prisma.user.findUnique({ where: { email: data.email } });
    if (exists) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }

    const passwordHash = await bcrypt.hash(data.password, 12);
    const slug = data.businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    const business = await prisma.business.create({
      data: {
        name: data.businessName,
        slug: `${slug}-${Date.now().toString(36)}`,
        users: {
          create: {
            email: data.email,
            passwordHash,
            name: data.name,
            role: 'ADMIN',
          },
        },
      },
      include: { users: true },
    });

    const user = business.users[0];
    const token = jwt.sign(
      { userId: user.id, businessId: business.id, role: user.role },
      process.env.NEXTAUTH_SECRET || 'dev-secret',
      { expiresIn: '14d' }
    );

    res.status(201).json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role }, business: { id: business.id, name: business.name, slug: business.slug } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
      return;
    }
    console.error('Register error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/login', authRateLimit, async (req, res) => {
  try {
    const data = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({
      where: { email: data.email },
      include: { business: true },
    });

    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      res.status(423).json({ error: 'Account locked. Try again later.' });
      return;
    }

    const validPassword = await bcrypt.compare(data.password, user.passwordHash);
    if (!validPassword) {
      const failedLogins = user.failedLogins + 1;
      const update: { failedLogins: number; lockedUntil?: Date } = { failedLogins };
      if (failedLogins >= 5) {
        update.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
      }
      await prisma.user.update({ where: { id: user.id }, data: update });
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    const token = jwt.sign(
      { userId: user.id, businessId: user.businessId, role: user.role },
      process.env.NEXTAUTH_SECRET || 'dev-secret',
      { expiresIn: '14d' }
    );

    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role }, business: { id: user.business.id, name: user.business.name, slug: user.business.slug } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
      return;
    }
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as authRouter };
