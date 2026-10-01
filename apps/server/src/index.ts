import './lib/sentry';
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import { initSocket } from './lib/socket';
import { getRedis, closeRedis } from './lib/redis';
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
import { telegramRouter } from './routes/telegram';
import { settingsRouter } from './routes/settings';
import { commandsRouter } from './routes/commands';
import { promptsRouter } from './routes/prompts';
import { createCatalogFeaturesRouter } from './routes/catalogFeatures';
import { industryTemplatesRouter } from './routes/industryTemplates';
import { botsRouter } from './routes/bots';
import { teamRouter } from './routes/team';
import { marketplaceRouter } from './routes/marketplace';
import { agencyRouter } from './routes/agency';
import { analyticsRouter } from './routes/analytics';
import { campaignsRouter } from './routes/campaigns';
import { whitelabelRouter } from './routes/whitelabel';
import { arenaRouter } from './routes/arena';
import { conversationsRouter } from './routes/conversations';
import { whatsappRouter } from './routes/whatsapp';
import { metaRouter } from './routes/meta';
import { publicChatRouter } from './routes/publicChat';
import { billingRouter } from './routes/billing';
import { plansRouter } from './routes/plans';
import { templatesRouter } from './routes/templates';
import { webhooksRouter } from './routes/webhooks';
import { posRouter } from './routes/pos';
import { voiceRouter } from './routes/voice';
import { brandRouter } from './routes/brand';
import { galeriaRouter } from './routes/galeria';
import { restoreActiveBots } from './services/telegram/bot';
import { startScheduler } from './services/scheduler';
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
import { Sentry } from './lib/sentry';

if (!process.env.NEXTAUTH_SECRET || process.env.NEXTAUTH_SECRET === 'dev-secret') {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('NEXTAUTH_SECRET must be set in production');
  }
  console.warn('WARNING: Using insecure default JWT secret. Set NEXTAUTH_SECRET in .env');
}

// META_APP_SECRET es opcional (el canal Meta lo es), por eso NO se tira throw.
// Pero si parece que el canal Meta está en uso (hay META_VERIFY_TOKEN) y falta
// el App Secret, la verificación de firma/propiedad de token de Meta falla
// CERRADO en producción (src/services/meta/client.ts): los webhooks entrantes
// serán rechazados. Avisamos claro al arrancar para no depurar a ciegas.
if (
  process.env.NODE_ENV === 'production' &&
  process.env.META_VERIFY_TOKEN &&
  !process.env.META_APP_SECRET
) {
  console.warn(
    'WARNING: META_VERIFY_TOKEN está seteado pero falta META_APP_SECRET. La ' +
      'verificación de firma/propiedad de token de Meta fallará cerrado en ' +
      'producción y los webhooks de Instagram/Messenger serán rechazados. ' +
      'Set META_APP_SECRET en el entorno.'
  );
}

const app = express();

// Cantidad de proxies de confianza delante del server (Cloud Run/LB = 1). Con
// esto req.ip toma el cliente real del X-Forwarded-For y el rate limit por IP
// funciona detrás del proxy. Por defecto 0 (sin confianza) para no permitir
// spoofing de X-Forwarded-For si se despliega sin proxy; ops lo setea según el
// deploy (TRUST_PROXY_HOPS=1 en Cloud Run).
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
if (Number.isFinite(trustProxyHops) && trustProxyHops > 0) {
  app.set('trust proxy', trustProxyHops);
}

const httpServer = createServer(app);
const defaultAllowedOrigins = ['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3000', 'http://127.0.0.1:3001'];
const allowedOrigins = Array.from(
  new Set([
    ...defaultAllowedOrigins,
    ...(process.env.FRONTEND_URLS || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    process.env.FRONTEND_URL,
  ].filter(Boolean) as string[])
);
const isLocalDevOrigin = (origin: string) =>
  process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
const corsOrigin: cors.CorsOptions['origin'] = (origin, callback) => {
  if (!origin || allowedOrigins.includes(origin) || isLocalDevOrigin(origin)) {
    callback(null, true);
    return;
  }
  callback(new Error(`CORS origin not allowed: ${origin}`));
};
const io = new Server(httpServer, {
  cors: { origin: corsOrigin, credentials: true },
});

// Escalado horizontal de Socket.IO: con REDIS_URL, el adaptador replica los
// eventos entre instancias (un emit desde cualquier réplica llega a todos los
// clientes). Sin Redis, queda el adaptador en memoria (válido single-node).
const redisForSockets = getRedis();
let socketSub: Redis | undefined;
if (redisForSockets) {
  // Guardamos el cliente `sub` para poder cerrarlo en el apagado. duplicate()
  // no copia listeners, así que le ponemos su propio handler de error.
  socketSub = redisForSockets.duplicate();
  socketSub.on('error', (err: Error) => console.error('[redis:sub] error:', err.message));
  io.adapter(createAdapter(redisForSockets, socketSub));
  console.log('[socket.io] Adaptador Redis habilitado (escalado multi-instancia).');
}

initSocket(io);

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
  origin: corsOrigin,
  credentials: true,
}));
app.use(morgan('dev'));
app.use(cookieParser());

// Middlewares de seguridad propios (ver src/middleware/security.ts)
app.use(extraSecurityHeaders);
app.use(validateRequestSize({ maxBodyBytes: 5 * 1024 * 1024 })); // 5 MB

// Stripe webhooks need the raw body for signature verification.
// This must be registered BEFORE express.json() parses the body.
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));

app.use(
  express.json({
    limit: '5mb',
    // Guardamos el cuerpo crudo para validar la firma HMAC del webhook de Meta
    // (X-Hub-Signature-256 se calcula sobre los bytes exactos, no el JSON parseado).
    verify: (req, _res, buf) => {
      (req as typeof req & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);
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
app.use('/api/telegram', telegramRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/commands', commandsRouter);
app.use('/api/prompts', promptsRouter);
app.use('/api/skills', createCatalogFeaturesRouter('skill'));
app.use('/api/superpowers', createCatalogFeaturesRouter('superpower'));
app.use('/api/plantillas-negocio', industryTemplatesRouter);
app.use('/api/bots', botsRouter);
app.use('/api/team', teamRouter);
app.use('/api/marketplace', marketplaceRouter);
app.use('/api/agency', agencyRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/whitelabel', whitelabelRouter);
app.use('/api/arena', arenaRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/whatsapp', whatsappRouter);
app.use('/api/meta', metaRouter);
app.use('/api/billing', billingRouter);
app.use('/api/plans', plansRouter);
app.use('/api/templates', templatesRouter);
app.use('/api/webhooks', webhooksRouter);
app.use('/api/pos', posRouter);
app.use('/api/voice', voiceRouter);
app.use('/api/brand', brandRouter);
app.use('/api/galeria', galeriaRouter);
app.use('/api/public', cors({ origin: true, credentials: false }), publicChatRouter);

// Ruta no encontrada (404) y manejador de errores centralizado.
// Deben registrarse al final, después de montar todas las rutas.
app.use('/api', notFoundHandler);
Sentry.setupExpressErrorHandler(app);
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

  // Restaurar bots de Telegram activos al iniciar el servidor
  restoreActiveBots().catch((err) => {
    console.error('Error al restaurar bots de Telegram:', err);
  });

  // Programar jobs diarios de superpoderes (reportes / recordatorios)
  startScheduler();
});

// Apagado limpio: en Cloud Run / K8s el contenedor recibe SIGTERM antes de
// matarse. Cerramos conexiones (HTTP, Socket.IO y Redis) para no dejar sockets
// colgados ni conexiones Redis huérfanas. Idempotente ante señales repetidas.
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} recibido; cerrando...`);

  // Forzamos la salida si algo se cuelga, para no quedar bloqueando el deploy.
  const forceExit = setTimeout(() => process.exit(0), 10_000);
  forceExit.unref?.();

  try {
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await Promise.allSettled([socketSub?.quit(), closeRedis()]);
  } catch (err) {
    console.error('[shutdown] error al cerrar:', (err as Error).message);
  } finally {
    process.exit(0);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

export { io };
