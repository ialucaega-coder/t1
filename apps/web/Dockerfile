# apps/web/Dockerfile
# Build multi-etapa para el frontend Next.js (apps/web) dentro del monorepo Turborepo.
# Se ejecuta con "docker build -f apps/web/Dockerfile ." desde la RAIZ del repo,
# porque necesita acceso a packages/shared y prisma/ (workspaces de npm).

# ---------------------------------------------------------------------------
# Etapa 1: deps — instala TODAS las dependencias del monorepo (workspaces)
# ---------------------------------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /repo

# Copiamos solo los manifiestos primero para aprovechar la cache de capas de Docker.
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/server/package.json ./apps/server/package.json
COPY packages/shared/package.json ./packages/shared/package.json

# npm ci instala todo el arbol de workspaces (necesario para turbo/prisma).
RUN npm ci

# ---------------------------------------------------------------------------
# Etapa 2: builder — genera el cliente de Prisma y compila Next.js
# ---------------------------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /repo

COPY --from=deps /repo/node_modules ./node_modules
COPY . .

# Genera el Prisma Client (requerido en build-time por Next.js/TypeScript).
RUN npx prisma generate --schema=prisma/schema.prisma

ENV NEXT_TELEMETRY_DISABLED=1
# Build solo del workspace "web" usando turbo (respeta dependsOn: ^build).
RUN npx turbo run build --filter=web

# ---------------------------------------------------------------------------
# Etapa 3: runner — imagen final minima usando la salida "standalone" de Next.js
# ---------------------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Usuario no-root por seguridad.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# La salida "standalone" incluye un server.js minimo con solo las
# dependencias necesarias en tiempo de ejecucion.
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/public ./apps/web/public

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000 || exit 1

# El entrypoint standalone de Next.js vive en apps/web/server.js
# (la ruta refleja la posicion del workspace dentro del monorepo).
CMD ["node", "apps/web/server.js"]
