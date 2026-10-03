# Credenciales — dónde va cada cosa (Local B)

Guía rápida de **qué credencial se carga dónde**. Dos grandes grupos:

1. **Variables de entorno (`.env` / Secret Manager / Vercel)** — a nivel
   plataforma. Las del backend van en `apps/server` (Cloud Run / Secret Manager);
   las del frontend en `apps/web` (Vercel). Nombres **exactos** tomados de
   `apps/server/.env.example` y `apps/web/.env.example`.
2. **Panel de Conexiones (por negocio)** — las integraciones **Cal.com,
   MercadoPago, ManyChat y Composio** NO se cargan por `.env`: se configuran
   negocio por negocio desde el panel, se validan contra el proveedor al conectar
   y se guardan **cifradas** (AES-256-GCM) en la base.

> ⚠️ Este archivo lista **solo los NOMBRES** de las variables y dónde van. No
> contiene (ni debe contener) ningún valor real de secreto. Los valores se cargan
> en Secret Manager / Vercel / el panel, nunca en el repo.

---

## Backend (`apps/server`) — Cloud Run / Secret Manager

| Qué | Variable(s) | Notas |
| --- | --- | --- |
| Base de datos (runtime) | `DATABASE_URL` | En prod: pooler transaccional Supabase (`:6543`, `pgbouncer=true`, `connection_limit` bajo). |
| Base de datos (migraciones) | `DIRECT_URL` | Conexión directa (`:5432`), sin pooler. |
| Auth / sesión | `NEXTAUTH_SECRET`, `JWT_EXPIRES_IN` | `NEXTAUTH_SECRET` debe ser **idéntico** al del frontend. |
| Cifrado en reposo | `ENCRYPTION_KEY` | Cifra secretos (TOTP de 2FA, credenciales de conectores). Si falta, se deriva de `NEXTAUTH_SECRET`; en prod usá una dedicada. |
| CORS | `FRONTEND_URL`, `FRONTEND_URLS` | `FRONTEND_URLS` = orígenes extra, coma-separados. |
| Servidor / proxy | `PORT`, `NODE_ENV`, `TRUST_PROXY_HOPS`, `RUN_SCHEDULER` | En Cloud Run: `TRUST_PROXY_HOPS=1`. `RUN_SCHEDULER=false` en todas las réplicas menos una. |
| Redis (opcional, escalado) | `REDIS_URL` | Solo si corrés 2+ instancias. |
| URL pública del backend | `API_PUBLIC_URL` | Base para armar webhooks (Telegram, ManyChat). |
| IA (cerebro del bot) | `AI_PROVIDER`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `OPENAI_API_KEY`, `OPENAI_MODEL` | `AI_PROVIDER` = `anthropic` \| `openai`. |
| Stripe (pagos plataforma) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Suscripciones y el cobro por defecto. |
| Twilio (voz + OTP/WhatsApp) | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `VOICE_LANGUAGE`, `VOICE_TTS_VOICE`, `DEFAULT_VOICE_BUSINESS_ID` | |
| Telegram | `TELEGRAM_BOT_TOKEN` | |
| WhatsApp (Cloud API) | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` | |
| Meta (Instagram / Messenger) | `META_VERIFY_TOKEN`, `META_APP_SECRET` | Firma y verificación de webhooks. |
| Email (Resend) | `RESEND_API_KEY`, `EMAIL_FROM` | |
| Supabase (CLI/Admin) | `SUPABASE_PROJECT_REF` | |
| Errores (Sentry) | `SENTRY_DSN` | |
| Reservas públicas | `PUBLIC_BOOKING_REQUIRE_OTP` | `true` exige OTP (requiere Twilio). |
| Webhooks (solo dev/test) | `SKIP_WEBHOOK_SIGNATURE_VALIDATION` | **Dejar sin setear en producción.** |

## Frontend (`apps/web`) — Vercel

| Qué | Variable(s) | Notas |
| --- | --- | --- |
| Base de datos | `DATABASE_URL`, `DIRECT_URL` | Para Server Components / Route Handlers. |
| Auth / sesión | `NEXTAUTH_SECRET`, `NEXTAUTH_URL` | `NEXTAUTH_SECRET` = **mismo valor** que el backend. |
| API del backend | `NEXT_PUBLIC_API_URL` | URL pública del server (Cloud Run). |
| Entorno | `NODE_ENV`, `PORT` | |
| Supabase (público) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | |
| Sentry | `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN` | |
| Stripe (checkout cliente) | `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Clave **pública** (`pk_...`). |
| PostHog (analítica) | `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` | Sin la key, PostHog queda deshabilitado. |

---

## Integraciones por negocio (panel de Conexiones, NO `.env`)

Se cargan desde el panel de **Conexiones** de cada negocio; se validan al conectar
y se guardan cifradas en la base. **No** usan variables de entorno.

| Integración | Qué se carga en el panel | Notas |
| --- | --- | --- |
| **Cal.com** | API key de Cal.com | Agenda externa + push de reservas. |
| **MercadoPago** | Access token | Pagos LATAM (Checkout Pro); selector Stripe/MercadoPago en Cobros. |
| **ManyChat** | API key | Canal bidireccional. El **webhook entrante** requiere que el backend sea accesible públicamente; el token del webhook se genera/rota en el panel y viaja en el header `x-webhook-token`. |
| **Composio** | API key | Conector base (status/connect/disconnect, solo ADMIN). |

> **Stripe es la excepción de "pagos":** las claves de plataforma
> (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`)
> van por `.env`/Secret Manager/Vercel. **MercadoPago**, en cambio, es por negocio
> y se carga desde el panel.
