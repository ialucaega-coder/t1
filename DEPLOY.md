# Deploy — Local B

Guia de despliegue del monorepo **Local B** (Turborepo).

- **`apps/web`** (Next.js 14) → **Vercel**
- **`apps/server`** (Express + TypeScript) → **Google Cloud Run** (contenedor)

Todo el CI/CD corre con **GitHub Actions**. Ningun secreto real vive en el
repositorio: todos se inyectan como **GitHub Actions Secrets**
(`Settings > Secrets and variables > Actions`) o se configuran directamente en
Vercel / Cloud Run.

---

## 1. Integracion continua (CI)

Workflow: `.github/workflows/ci.yml` — corre en cada **push a `main`** y en cada
**Pull Request**.

Jobs:

1. **Lint** — `npm run lint` (turbo).
2. **Type Check** — `tsc --noEmit` en `apps/server` y `apps/web` (genera Prisma Client antes).
3. **Test** — `npm run test --workspaces --if-present`, con un servicio Postgres efimero.
4. **Build** — build de produccion de todos los workspaces; sube artefactos de `.next` y `dist`.

No requiere secrets: usa valores dummy solo para que el build no falle por envs ausentes.

---

## 2. Deploy de `apps/web` a Vercel

Workflow: `.github/workflows/deploy-web.yml` — corre en **push a `main`**
(o manualmente via `workflow_dispatch`).

### Secrets de GitHub requeridos

| Secret               | Descripcion                                                        |
| -------------------- | ------------------------------------------------------------------ |
| `VERCEL_TOKEN`       | Token personal de Vercel (`Account Settings > Tokens`).            |
| `VERCEL_ORG_ID`      | ID de la organizacion / team de Vercel.                            |
| `VERCEL_PROJECT_ID`  | ID del proyecto de Vercel asociado a `apps/web`.                   |

### Como obtener los IDs

```bash
npm i -g vercel
vercel login
# Desde la raiz del repo, vincula el proyecto una vez:
vercel link
# Esto crea .vercel/project.json con orgId y projectId:
cat .vercel/project.json
```

Carga esos valores como secrets en GitHub. El token se genera en el dashboard de Vercel.

### Variables de entorno de la app (en Vercel, NO en el repo)

Configuralas en `Vercel > Project > Settings > Environment Variables`:

- `DATABASE_URL`, `DIRECT_URL`
- `NEXTAUTH_SECRET`, `NEXTAUTH_URL`
- `NEXT_PUBLIC_API_URL` (URL publica del backend en Cloud Run)
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` (ver seccion 4)

> El build usa la config de `vercel.json` (Prisma generate + `npm run build`).

---

## 3. Deploy de `apps/server` a Google Cloud Run

Workflow: `.github/workflows/deploy-server.yml` — corre en **push a `main`**
(o manualmente via `workflow_dispatch`). Buildea la imagen con
`apps/server/Dockerfile` (multi-stage, Node 20 alpine, `EXPOSE 4000`), la sube a
**Artifact Registry** y actualiza el servicio de **Cloud Run**.

### Secrets de GitHub requeridos

| Secret              | Descripcion                                                             |
| ------------------- | ---------------------------------------------------------------------- |
| `GCP_PROJECT_ID`    | ID del proyecto de Google Cloud.                                       |
| `GCP_SA_KEY`        | JSON completo de la Service Account (credenciales).                    |
| `GCP_REGION`        | Region de Cloud Run (ej. `southamerica-east1`).                       |
| `CLOUD_RUN_SERVICE` | Nombre del servicio de Cloud Run a actualizar.                        |

### Preparar Google Cloud (una vez)

```bash
# Habilitar APIs necesarias
gcloud services enable run.googleapis.com artifactregistry.googleapis.com

# Crear Service Account para el deploy
gcloud iam service-accounts create github-deployer \
  --display-name="GitHub Actions deployer"

# Roles minimos
PROJECT_ID="tu-proyecto"
SA="github-deployer@${PROJECT_ID}.iam.gserviceaccount.com"
for ROLE in roles/run.admin roles/artifactregistry.writer roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$SA" --role="$ROLE"
done

# Generar la clave JSON (cargar su contenido como secret GCP_SA_KEY)
gcloud iam service-accounts keys create key.json --iam-account="$SA"
```

Cargá el contenido de `key.json` como secret `GCP_SA_KEY` y **borralo localmente**
(`rm key.json`). Nunca lo commitees.

### Variables de entorno de la app (en Cloud Run, NO en el repo)

Configuralas en el servicio de Cloud Run (`Variables & Secrets`), idealmente via
**Secret Manager**: `DATABASE_URL`, `DIRECT_URL`, `NEXTAUTH_SECRET`,
`ANTHROPIC_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `TWILIO_*`,
`RESEND_API_KEY`, `SENTRY_DSN`, etc. El workflow no las toca. Lista completa con
comentarios en `apps/server/.env.example`.

Config de producción a no olvidar (además de los secrets):

- **`TRUST_PROXY_HOPS=1`** — detrás del proxy de Cloud Run, para que `req.ip`
  tome el cliente real de `X-Forwarded-For` y el rate limit por IP funcione.
  Sin esto (default `0`) el rate limit ve la IP del proxy.
- **`FRONTEND_URLS`** — orígenes CORS permitidos (coma-separados) si hay más de
  un dominio de frontend; complementa a `FRONTEND_URL`.
- **`API_PUBLIC_URL`** — URL pública del backend (para armar webhooks, ej. Telegram).
- **`META_VERIFY_TOKEN` / `META_APP_SECRET`** — si se usa el canal Instagram/Messenger.
- **`PUBLIC_BOOKING_REQUIRE_OTP=true`** — para exigir verificación de teléfono en
  reservas públicas (requiere Twilio configurado).
- **`SKIP_WEBHOOK_SIGNATURE_VALIDATION`** — dejar **sin setear** en producción.
  Los webhooks validan firma por defecto; esta variable solo la saltea en dev/test.
- **`RUN_SCHEDULER`** — el scheduler de superpoderes (reportes/recordatorios
  diarios) usa `node-cron` en memoria del proceso. Con **una sola instancia** no
  hace falta tocar nada (corre por defecto). Si escalás horizontalmente a más de
  una instancia, poné **`RUN_SCHEDULER=false` en todas menos una**, o cada
  instancia disparará los jobs y duplicará las notificaciones diarias.
- **`REDIS_URL`** — **opcional**, para escalado horizontal (ver abajo).

### Escalado horizontal (múltiples instancias)

Con **una sola instancia** no hace falta nada: todo funciona con los fallbacks
en memoria. Al correr **2+ réplicas** detrás de un balanceador, seteá
**`REDIS_URL`** (ej. Memorystore en GCP) en todas las instancias para que:

- **Rate limiting** sea distribuido — el conteo por IP se comparte entre réplicas
  (`INCR`/`PEXPIRE` en Redis). Sin Redis, cada proceso cuenta por separado, así
  que el límite efectivo se multiplica por la cantidad de instancias. Si Redis se
  cae, el limitador degrada *fail-open* (permite) para no tumbar la API.
- **Socket.IO** replique los eventos en tiempo real entre réplicas (adaptador
  Redis). Sin esto, un `emit` solo llega a los clientes conectados a la misma
  instancia que lo emitió; con varias réplicas, se perderían notificaciones.

Checklist multi-instancia: `REDIS_URL` en todas + `RUN_SCHEDULER=false` en todas
menos una + `TRUST_PROXY_HOPS=1`.

### Base de datos y migraciones

El esquema vive en `prisma/schema.prisma`. Ya existe la **migración baseline
versionada** en `prisma/migrations/0_init/` (generada desde el schema actual con
`prisma migrate diff --from-empty`, representa TODO el esquema vigente).

> ⚠️ **La base ya tiene las tablas** (se venían creando con `db push`). Por eso
> NO corras `db:migrate`/`migrate dev` contra una base existente: detectaría
> "drift" y podría **resetear datos**. Hay que **baselinar** una sola vez.

**Adopción de migraciones sobre una base EXISTENTE (baseline, no destructivo):**

```bash
# 1) Marcar la baseline como YA aplicada (NO ejecuta el SQL: las tablas ya existen).
#    Correr una vez por entorno (staging y prod), contra DIRECT_URL.
npx prisma migrate resolve --applied 0_init --schema=prisma/schema.prisma

# 2) De ahí en más, en cada deploy aplicar migraciones pendientes (idempotente):
npm run db:migrate:deploy
```

**Base NUEVA/vacía (ej. staging desde cero):** `npm run db:migrate:deploy` aplica
`0_init` directamente (crea todo el esquema).

**Nuevas migraciones a futuro:** editás `schema.prisma`, generás la migración con
`npm run db:migrate -- --name <cambio>` en un entorno de desarrollo (usa `DIRECT_URL`,
no el pooler), la revisás, y se aplica en deploy con `db:migrate:deploy`.

### Probar la imagen localmente

```bash
# Desde la RAIZ del repo:
docker build -f apps/server/Dockerfile -t local-b-server .
docker run --rm -p 4000:4000 --env-file apps/server/.env local-b-server
# Healthcheck:
curl http://localhost:4000/api/health
```

---

## 4. Analitica de producto — PostHog (`apps/web`)

PostHog se inicializa **solo si** `NEXT_PUBLIC_POSTHOG_KEY` esta seteada (mismo
patron condicional que Sentry). Sin la clave, no carga nada.

Envs (documentadas en `apps/web/.env.example`):

- `NEXT_PUBLIC_POSTHOG_KEY` — Project API Key de PostHog.
- `NEXT_PUBLIC_POSTHOG_HOST` — host de ingesta (default `https://us.i.posthog.com`;
  EU: `https://eu.i.posthog.com`).

Implementacion:

- Provider client-side: `apps/web/src/lib/posthog-provider.tsx` (usa `posthog-js`).
- Integrado en el layout raiz: `apps/web/src/app/layout.tsx`.
- Captura **pageviews** automaticamente en cada cambio de ruta del App Router.

Para produccion, cargá `NEXT_PUBLIC_POSTHOG_KEY` y `NEXT_PUBLIC_POSTHOG_HOST`
como env vars en Vercel.

---

## 5. Backups y restore (Supabase)

La base de datos vive en **Supabase (PostgreSQL)**. Supabase realiza **backups
automáticos** del proyecto (diarios en los planes pagos; PITR / Point-in-Time
Recovery disponible como add-on). Los backups existen — pero un backup que nunca
se probó no es un backup: **hay que probar el restore periódicamente**.

### Por qué probar el restore

- Verifica que el backup es íntegro y realmente restaurable.
- Mide y valida el **RTO** (tiempo objetivo de recuperación) y el **RPO**
  (pérdida de datos aceptable) reales frente a los que asume el negocio.
- Ejercita el runbook para que en un incidente real no se improvise.

### Procedimiento recomendado (a un entorno de STAGING, nunca sobre producción)

1. **Crear un destino aislado.** Provisioná un proyecto/instancia de Supabase de
   **staging** separado de producción. El restore de prueba NUNCA se hace sobre
   el proyecto productivo.
2. **Tomar el backup de origen.** En Supabase Dashboard → `Database > Backups`,
   elegí el backup más reciente (o un punto en el tiempo con PITR). Alternativa
   por CLI: `supabase db dump --db-url "$DIRECT_URL" -f backup.sql` contra
   producción (usar `DIRECT_URL`, conexión directa, no el pooler).
3. **Restaurar en staging.** Restaurá el backup/punto elegido en el proyecto de
   staging (desde el Dashboard, o `psql "$STAGING_DIRECT_URL" -f backup.sql`).
   Cronometrá el proceso de punta a punta → ese es tu **RTO** medido.
4. **Verificar integridad.** Contra staging:
   - Comparar conteos de filas de las tablas críticas (`Business`, `User`,
     `Conversation`, reservas) contra producción.
   - Correr `prisma migrate status` (o `db:push` en dry-run) para confirmar que
     el esquema restaurado coincide con `prisma/schema.prisma`.
   - Hacer un smoke test de la app apuntando `DATABASE_URL`/`DIRECT_URL` a
     staging: login, listar datos, crear un registro de prueba.
5. **Documentar resultados.** Registrar fecha del backup restaurado, RTO medido,
   RPO observado (antigüedad del último backup disponible) y cualquier anomalía.
6. **Limpiar.** Dar de baja el proyecto de staging o su acceso; borrar los dumps
   locales (contienen datos productivos) y nunca commitearlos.

> Frecuencia sugerida: probar el restore al menos una vez por trimestre y después
> de cualquier cambio grande de esquema. Guardá el último resultado documentado
> junto a este runbook o en el gestor de incidentes del equipo.

---

## 6. Checklist antes de mergear a `main`

- [ ] `npx tsc --noEmit -p apps/web/tsconfig.json` pasa sin errores.
- [ ] `npx tsc --noEmit -p apps/server/tsconfig.json` pasa sin errores.
- [ ] Secrets de Vercel cargados (`VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`).
- [ ] Secrets de GCP cargados (`GCP_PROJECT_ID`, `GCP_SA_KEY`, `GCP_REGION`, `CLOUD_RUN_SERVICE`).
- [ ] Env vars de la app configuradas en Vercel y Cloud Run (nunca en el repo).
