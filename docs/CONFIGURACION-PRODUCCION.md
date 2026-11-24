# Configuración de producción — qué cargar y dónde

Guía operativa para el dueño. Los valores secretos se cargan directo en cada panel,
nunca en el repo ni en un chat. Detalle técnico en `DEPLOY.md` y `apps/server/.env.example`.

## 1. Supabase

| Variable | Qué copiar (botón **Connect**) | Va en |
|---|---|---|
| `DATABASE_URL` | Transaction pooler, puerto 6543, + `?pgbouncer=true&connection_limit=5` | Cloud Run |
| `DIRECT_URL` | Direct connection, puerto 5432 (si tu red no tiene IPv6, usá Session pooler 5432) | Cloud Run y tu PC para migrar |

- Correr `docs/migraciones/revocar-permisos-anon.sql` en el SQL Editor (verificación final: `0`).
- Mantener la Data API apagada.
- Confirmar backups activos (`DEPLOY.md` §5).
- Migraciones, una vez, desde tu PC contra `DIRECT_URL`, en este orden:

```bash
npx prisma migrate resolve --applied 0_init --schema=prisma/schema.prisma
npx prisma migrate deploy --schema=prisma/schema.prisma
```

No usar `migrate dev` contra esta base (puede resetear datos).

## 2. Vercel (apps/web)

Secrets de GitHub: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` (salen de `vercel link`).

| Variable | Valor |
|---|---|
| `NEXT_PUBLIC_API_URL` | Imprescindible. URL pública del server |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_...` |
| `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN` | Opcionales |
| `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` | Opcionales |
| `NEXT_PUBLIC_SOCKET_TRANSPORTS=websocket` | Solo con 2+ instancias del server sin sticky sessions |

El código de `apps/web/src` no lee `DATABASE_URL`, `NEXTAUTH_*` ni `NEXT_PUBLIC_SUPABASE_*`
(verificado 2026-11-15): no hace falta poner credenciales de la base en Vercel.

## 3. Google Cloud Run (apps/server)

Secrets de GitHub: `GCP_PROJECT_ID`, `GCP_SA_KEY`, `GCP_REGION`, `CLOUD_RUN_SERVICE`.

Variables del servicio (idealmente en Secret Manager):

- Obligatorias: `DATABASE_URL`, `DIRECT_URL`, `NEXTAUTH_SECRET` (`openssl rand -base64 32`),
  `ENCRYPTION_KEY` (propia), `PLATFORM_ADMIN_EMAILS`, `FRONTEND_URL`, `FRONTEND_URLS`,
  `API_PUBLIC_URL`, `TRUST_PROXY_HOPS=1`, `NODE_ENV=production`.
- IA: `ANTHROPIC_API_KEY` (y/o `OPENAI_API_KEY`), `AI_PROVIDER`. El modelo sale del
  catálogo (`services/ai/catalog.ts`), NO de `ANTHROPIC_MODEL`. Opcionales:
  `AI_FAILOVER=false` (apaga el respaldo entre proveedores), `LLM_TIMEOUT_MS` (default 30000).
  Cada negocio puede fijar su tope mensual de gasto de IA desde el panel.
- Pagos: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
- Canales: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`,
  `META_VERIFY_TOKEN`, `META_APP_SECRET`. Telegram: cada negocio carga su bot.
- Email: `RESEND_API_KEY`, `EMAIL_FROM` (mails y campañas por email). Errores: `SENTRY_DSN`.
- Links públicos: `API_PUBLIC_URL` (dominio público del API, con HTTPS: lo necesita
  MercadoPago para avisar los pagos y Telegram para el webhook; también el pixel y las
  redirecciones del tracking de aperturas/clics de campañas por email: sin ella los emails
  salen sin medición) y `FRONTEND_URL` (links de invitación de equipo).
- Colas y jobs: `IDEMPOTENCY_TTL_DAYS` (default 30; purga de claves viejas),
  `QUEUES_DISABLED=true` (fuerza modo inline aun con Redis), `RUN_WORKERS=false` y
  `RUN_SCHEDULER=false` (dejan una instancia sin workers / sin cron; ver sección 4).
- Solo desarrollo: `DEV_LOG_INVITE_LINKS` (loguea links de invitación; no setear en producción).
- Opcional: `PUBLIC_BOOKING_REQUIRE_OTP=true` (requiere Twilio).
- Nunca setear `SKIP_WEBHOOK_SIGNATURE_VALIDATION`.

## 4. Redis (solo con 2+ instancias)

`REDIS_URL` en todas las instancias; al menos una con workers (no poner `RUN_WORKERS=false`
en todas) y al menos una con scheduler (no poner `RUN_SCHEDULER=false` en todas): el
scheduler dispara los jobs diarios y, cada minuto, el envío de campañas programadas. `connection_limit × instancias` debe quedar bajo el máximo del pooler de Supabase.

## 5. Webhooks externos (URLs reales, verificadas en el código)

| Servicio | URL |
|---|---|
| Stripe | `https://<server>/api/billing/webhook` |
| Twilio WhatsApp | `https://<server>/api/whatsapp/webhook` |
| Twilio Voz | `https://<server>/api/voice/incoming` |
| Meta (Instagram/Messenger) | `https://<server>/api/meta/webhook` (GET de verificación + POST) |
| Telegram | Se registra solo al conectar el bot (`/api/telegram/webhook/<negocio>`) |
| MercadoPago | `https://<server>/api/mercadopago/webhook/<negocio>` (requiere `API_PUBLIC_URL`) |
| ManyChat | `https://<server>/api/manychat/webhook/<negocio>`, con el header `x-webhook-token` |

## 6. Orden sugerido

1. Supabase: SQL de permisos, backups, migraciones.
2. Cloud Run: secrets de GitHub + variables; primer deploy.
3. Vercel: secrets + `NEXT_PUBLIC_API_URL`; deploy.
4. Webhooks externos (sección 5).
5. Smoke QA (`DEPLOY.md` §0, paso 6).
