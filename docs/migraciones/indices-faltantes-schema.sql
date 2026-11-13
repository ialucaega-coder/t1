-- =====================================================================
-- Índices que el schema YA declara (@@index/@@unique) y que NO existen en la base
-- real. Verificado el 2026-11-13 contra pg_indexes: faltan 27 de 52.
-- Alinear la base con el schema NO cambia el schema (sigue congelado), pero sí
-- toca la base: lo corre el DUEÑO. NO APLICADO.
--
-- Causa probable: la base se armó con `db push` antes de agregar esos índices y
-- la baseline 0_init se marcó como aplicada sin ejecutarse (ver DEPLOY.md).
--
-- Cómo aplicar: UNA sentencia por vez en el SQL editor de Supabase
-- (CREATE INDEX CONCURRENTLY no corre en transacción). Todas son IF NOT EXISTS.
-- La base hoy es chica, así que cada una tarda milisegundos; igual conviene
-- hacerlo ANTES de que crezca. Los nombres siguen la convención de Prisma, así
-- `prisma migrate diff` no los verá como drift.
-- =====================================================================

-- ---------- UNIQUE (primero verificar duplicados; si hay, el índice falla) ----------
-- SELECT "professionalId","dayOfWeek","startTime",count(*) FROM schedules GROUP BY 1,2,3 HAVING count(*)>1;
-- SELECT "businessId",email,count(*) FROM team_members GROUP BY 1,2 HAVING count(*)>1;
-- SELECT "itemId","businessId",count(*) FROM marketplace_installs GROUP BY 1,2 HAVING count(*)>1;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "schedules_professionalId_dayOfWeek_startTime_key"
  ON "schedules" ("professionalId", "dayOfWeek", "startTime");

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "team_members_businessId_email_key"
  ON "team_members" ("businessId", "email");

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "marketplace_installs_itemId_businessId_key"
  ON "marketplace_installs" ("itemId", "businessId");

-- ---------- Índices normales ----------
CREATE INDEX CONCURRENTLY IF NOT EXISTS "users_businessId_role_createdAt_idx"
  ON "users" ("businessId", "role", "createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "users_businessId_phone_idx"
  ON "users" ("businessId", "phone");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "schedules_businessId_dayOfWeek_isActive_idx"
  ON "schedules" ("businessId", "dayOfWeek", "isActive");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "services_businessId_isActive_idx"
  ON "services" ("businessId", "isActive");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "bookings_professionalId_date_idx"
  ON "bookings" ("professionalId", "date");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "bookings_businessId_date_status_idx"
  ON "bookings" ("businessId", "date", "status");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "bookings_businessId_createdAt_idx"
  ON "bookings" ("businessId", "createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "bookings_clientId_date_idx"
  ON "bookings" ("clientId", "date");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "bookings_serviceId_idx"
  ON "bookings" ("serviceId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "products_businessId_isActive_idx"
  ON "products" ("businessId", "isActive");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "orders_businessId_createdAt_idx"
  ON "orders" ("businessId", "createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "orders_businessId_status_createdAt_idx"
  ON "orders" ("businessId", "status", "createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "promotions_businessId_isActive_idx"
  ON "promotions" ("businessId", "isActive");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "transactions_businessId_createdAt_idx"
  ON "transactions" ("businessId", "createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "transactions_businessId_type_createdAt_idx"
  ON "transactions" ("businessId", "type", "createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "notifications_userId_isRead_createdAt_idx"
  ON "notifications" ("userId", "isRead", "createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "notifications_businessId_createdAt_idx"
  ON "notifications" ("businessId", "createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "connections_businessId_type_idx"
  ON "connections" ("businessId", "type");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "connections_type_isActive_idx"
  ON "connections" ("type", "isActive");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "conversations_businessId_updatedAt_idx"
  ON "conversations" ("businessId", "updatedAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "conversations_businessId_status_updatedAt_idx"
  ON "conversations" ("businessId", "status", "updatedAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "conversations_businessId_createdAt_idx"
  ON "conversations" ("businessId", "createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "messages_conversationId_createdAt_idx"
  ON "messages" ("conversationId", "createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "subscriptions_planId_idx"
  ON "subscriptions" ("planId");
