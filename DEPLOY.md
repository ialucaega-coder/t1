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
`ANTHROPIC_API_KEY`, `STRIPE_SECRET_KEY`, `TWILIO_*`, `RESEND_API_KEY`,
`SENTRY_DSN`, etc. El workflow no las toca.

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

## 5. Checklist antes de mergear a `main`

- [ ] `npx tsc --noEmit -p apps/web/tsconfig.json` pasa sin errores.
- [ ] `npx tsc --noEmit -p apps/server/tsconfig.json` pasa sin errores.
- [ ] Secrets de Vercel cargados (`VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`).
- [ ] Secrets de GCP cargados (`GCP_PROJECT_ID`, `GCP_SA_KEY`, `GCP_REGION`, `CLOUD_RUN_SERVICE`).
- [ ] Env vars de la app configuradas en Vercel y Cloud Run (nunca en el repo).
