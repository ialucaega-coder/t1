# apps/server/Dockerfile
# Build multi-etapa para la API Express (apps/server) dentro del monorepo Turborepo.
# Se ejecuta con "docker build -f apps/server/Dockerfile ." desde la RAIZ del repo.

# ---------------------------------------------------------------------------
# Etapa 1: deps — instala TODAS las dependencias del monorepo (workspaces)
# ---------------------------------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /repo

COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/server/package.json ./apps/server/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN npm ci

# ---------------------------------------------------------------------------
# Etapa 2: builder — genera el cliente de Prisma y compila TypeScript -> JS
# ---------------------------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /repo

COPY --from=deps /repo/node_modules ./node_modules
COPY . .

RUN npx prisma generate --schema=prisma/schema.prisma
RUN npx turbo run build --filter=server

# Elimina devDependencies del arbol final para achicar node_modules en runtime.
RUN npm prune --omit=dev

# ---------------------------------------------------------------------------
# Etapa 3: runner — imagen final de produccion
# ---------------------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

RUN addgroup -g 1001 -S nodejs && adduser -S expressjs -u 1001

# node_modules ya podados (sin devDependencies) desde el builder.
COPY --from=builder --chown=expressjs:nodejs /repo/node_modules ./node_modules
COPY --from=builder --chown=expressjs:nodejs /repo/apps/server/dist ./apps/server/dist
COPY --from=builder --chown=expressjs:nodejs /repo/apps/server/package.json ./apps/server/package.json
COPY --from=builder --chown=expressjs:nodejs /repo/prisma ./prisma
COPY --from=builder --chown=expressjs:nodejs /repo/node_modules/.prisma ./node_modules/.prisma

USER expressjs

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/api/health || exit 1

CMD ["node", "apps/server/dist/index.js"]
