-- DropIndex
DROP INDEX "users_businessId_idx";

-- DropIndex
DROP INDEX "users_email_idx";

-- DropIndex
DROP INDEX "users_phone_idx";

-- DropIndex
DROP INDEX "schedules_professionalId_idx";

-- DropIndex
DROP INDEX "schedules_businessId_idx";

-- DropIndex
DROP INDEX "bookings_businessId_date_idx";

-- DropIndex
DROP INDEX "bookings_clientId_idx";

-- DropIndex
DROP INDEX "bookings_status_idx";

-- DropIndex
DROP INDEX "orders_status_idx";

-- DropIndex
DROP INDEX "notifications_businessId_isRead_idx";

-- DropIndex
DROP INDEX "notifications_userId_idx";

-- DropIndex
DROP INDEX "connections_businessId_idx";

-- DropIndex
DROP INDEX "conversations_businessId_idx";

-- DropIndex
DROP INDEX "messages_conversationId_idx";

-- DropIndex
DROP INDEX "messages_createdAt_idx";

-- DropIndex
DROP INDEX "subscriptions_businessId_idx";

-- CreateIndex
CREATE INDEX "users_businessId_role_createdAt_idx" ON "users"("businessId", "role", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "users_businessId_phone_idx" ON "users"("businessId", "phone");

-- CreateIndex
CREATE INDEX "bookings_businessId_date_status_idx" ON "bookings"("businessId", "date", "status");

-- CreateIndex
CREATE INDEX "bookings_businessId_createdAt_idx" ON "bookings"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "bookings_clientId_date_idx" ON "bookings"("clientId", "date");

-- CreateIndex
CREATE INDEX "bookings_serviceId_idx" ON "bookings"("serviceId");

-- CreateIndex
CREATE INDEX "orders_businessId_status_createdAt_idx" ON "orders"("businessId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "transactions_businessId_type_createdAt_idx" ON "transactions"("businessId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_isRead_createdAt_idx" ON "notifications"("userId", "isRead", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "notifications_businessId_createdAt_idx" ON "notifications"("businessId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "connections_businessId_type_idx" ON "connections"("businessId", "type");

-- CreateIndex
CREATE INDEX "connections_type_isActive_idx" ON "connections"("type", "isActive");

-- CreateIndex
CREATE INDEX "conversations_businessId_updatedAt_idx" ON "conversations"("businessId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "conversations_businessId_status_updatedAt_idx" ON "conversations"("businessId", "status", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "conversations_businessId_createdAt_idx" ON "conversations"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "messages_conversationId_createdAt_idx" ON "messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "marketplace_installs_businessId_idx" ON "marketplace_installs"("businessId");

-- CreateIndex
CREATE INDEX "subscriptions_planId_idx" ON "subscriptions"("planId");

