import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { authRouter } from './routes/auth';
import { bookingsRouter } from './routes/bookings';
import { servicesRouter } from './routes/services';
import { productsRouter } from './routes/products';
import { clientsRouter } from './routes/clients';
import { ordersRouter } from './routes/orders';
import { transactionsRouter } from './routes/transactions';
import { notificationsRouter } from './routes/notifications';
import { categoriesRouter } from './routes/categories';
import { professionalsRouter } from './routes/professionals';
import { statsRouter } from './routes/stats';
import { schedulesRouter } from './routes/schedules';
import { aiRouter } from './routes/ai';
import { apiRateLimit } from './middleware/rateLimit';
import {
  extraSecurityHeaders,
  sanitizeRequest,
  validateRequestSize,
  csrfProtection,
  issueCsrfToken,
} from './middleware/security';
import { auditDataMutations, auditRateLimitViolations } from './middleware/audit';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

if (!process.env.NEXTAUTH_SECRET || process.env.NEXTAUTH_SECRET === 'dev-secret') {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('NEXTAUTH_SECRET must be set in production');
  }
  console.warn('WARNING: Using insecure default JWT secret. Set NEXTAUTH_SECRET in .env');
}

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: process.env.FRONTEND_URL || 'http://localhost:3000' },
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(morgan('dev'));
app.use(cookieParser());

// Middlewares de seguridad propios (ver src/middleware/security.ts)
app.use(extraSecurityHeaders);
app.use(validateRequestSize({ maxBodyBytes: 5 * 1024 * 1024 })); // 5 MB

app.use(express.json({ limit: '5mb' }));
app.use(sanitizeRequest);
app.use(issueCsrfToken);
app.use(csrfProtection);

app.use(apiRateLimit);
app.use(auditRateLimitViolations);
app.use(auditDataMutations);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRouter);
app.use('/api/bookings', bookingsRouter);
app.use('/api/services', servicesRouter);
app.use('/api/products', productsRouter);
app.use('/api/clients', clientsRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/transactions', transactionsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/professionals', professionalsRouter);
app.use('/api/stats', statsRouter);
app.use('/api/schedules', schedulesRouter);
app.use('/api/ai', aiRouter);

// Ruta no encontrada (404) y manejador de errores centralizado.
// Deben registrarse al final, después de montar todas las rutas.
app.use('/api', notFoundHandler);
app.use(errorHandler);

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on('join-business', (businessId: string) => {
    socket.join(`business:${businessId}`);
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export { io };
