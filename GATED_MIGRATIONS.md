# Migraciones con gate (revisión manual del coordinador)

Este documento registra migraciones de base de datos que **no se aplican automáticamente**.
Requieren revisión y ejecución manual por el coordinador porque pueden impactar performance
en tablas grandes o porque requieren deduplicación de datos previa.

> El schema (`prisma/schema.prisma`) está normalmente **congelado**. Los cambios de abajo se
> generan como archivos de migración (`prisma migrate diff`) **sin tocar la DB** y sin commitear;
> el coordinador revisa, commitea y decide cómo desplegar.

---

## 1. `20261003120000_add_perf_indexes` — Índices de performance (LISTA para revisión)

Migración puramente aditiva/reorganizadora de **índices**. No toca columnas, modelos,
`@@unique` ni CHECK constraints. El SQL generado contiene **solo `CREATE INDEX` / `DROP INDEX`**
(16 `DROP INDEX`, 18 `CREATE INDEX`), verificado sin operaciones destructivas.

### Qué agrega / reemplaza

| Modelo (tabla) | Cambio |
|---|---|
| `User` (users) | Se eliminan `[businessId]`, `[email]`, `[phone]`. Se agregan `[businessId, role, createdAt DESC]` y `[businessId, phone]`. El `@unique` de email ya provee índice. |
| `Schedule` (schedules) | Se eliminan `[professionalId]` y `[businessId]` por ser **prefijo redundante** del `@@unique([professionalId, dayOfWeek, startTime])` y del `[businessId, dayOfWeek, isActive]`. |
| `Booking` (bookings) | Se mantiene `[professionalId, date]`. Se eliminan `[businessId, date]`, `[clientId]`, `[status]`. Se agregan `[businessId, date, status]`, `[businessId, createdAt]`, `[clientId, date]`, `[serviceId]`. |
| `Order` (orders) | Se reemplaza `[status]` por `[businessId, status, createdAt]`. Se mantienen `[businessId, createdAt]` y `[clientId]`. |
| `Transaction` (transactions) | Se agrega `[businessId, type, createdAt]`. Se mantienen `[businessId, createdAt]` y `[orderId]`. |
| `Notification` (notifications) | Se reemplazan `[businessId, isRead]` y `[userId]` por `[userId, isRead, createdAt DESC]` y `[businessId, createdAt DESC]`. |
| `Connection` (connections) | Se reemplaza `[businessId]` por `[businessId, type]` y `[type, isActive]`. |
| `Conversation` (conversations) | Se reemplaza `[businessId]` por `[businessId, updatedAt DESC]`, `[businessId, status, updatedAt DESC]` y `[businessId, createdAt]`. Se mantiene `[botId]`. |
| `Message` (messages) | Se reemplaza `[conversationId]` por `[conversationId, createdAt]`. Se **elimina** `[createdAt]` (ningún reporte consulta mensajes sin scope de conversación/negocio; ver nota). |
| `MarketplaceInstall` (marketplace_installs) | Se agrega `[businessId]` (no es prefijo del `@@unique([itemId, businessId])`). |
| `Subscription` (subscriptions) | Se elimina `[businessId]` (duplica el `@unique` de `businessId`). Se agrega `[planId]`. |

**Nota sobre `Message.[createdAt]`:** se verificó en el código del server
(`routes/analytics.ts`, `routes/stats.ts`, `services/superpowers/report.ts`) que **todas** las
consultas de mensajes por fecha incluyen `conversation: { businessId }`, y las lecturas por
`findMany` filtran por `conversationId` con `orderBy: createdAt`. El índice compuesto
`[conversationId, createdAt]` cubre ambos patrones, por lo que `[createdAt]` quedaba sin uso.

### Advertencia de despliegue en tablas grandes

En PostgreSQL, `CREATE INDEX` toma un **lock de escritura** (`SHARE`) que bloquea `INSERT/UPDATE/DELETE`
sobre la tabla mientras se construye. En tablas con mucho volumen (p. ej. `messages`, `bookings`,
`transactions`) conviene crear los índices **a mano con `CREATE INDEX CONCURRENTLY`**, que no bloquea
escrituras. Consideraciones:

- `CONCURRENTLY` **no puede correr dentro de una transacción**, por lo que no se puede usar tal cual
  en una migración estándar de Prisma (que envuelve el `.sql` en una transacción).
- Si se opta por `CONCURRENTLY`, ejecutar los `CREATE INDEX CONCURRENTLY` / `DROP INDEX CONCURRENTLY`
  manualmente contra la DB y luego marcar la migración como aplicada con
  `prisma migrate resolve --applied 20261003120000_add_perf_indexes`.
- Los `DROP INDEX` de índices redundantes son baratos, pero igual conviene `DROP INDEX CONCURRENTLY`
  en producción para no tomar locks.

Ejemplo (versión concurrente, a correr manualmente fuera de transacción):

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "bookings_businessId_date_status_idx"
  ON "bookings" ("businessId", "date", "status");
-- ... (resto de CREATE INDEX con CONCURRENTLY)
DROP INDEX CONCURRENTLY IF EXISTS "bookings_businessId_date_idx";
-- ... (resto de DROP INDEX)
```

---

## Pendientes que requieren dedup de datos (NO aplicados)

Los siguientes cambios **no** están en la migración de índices porque agregan restricciones de
unicidad / CHECK que **fallarán si existen datos que las violan**. Antes de aplicarlos hay que
**deduplicar / corregir** los datos. Se documentan aquí con el SQL de dedup necesario, pero
**sin aplicarlos** (van en otra tanda, con su propia migración gated).

### A. `Connection` singleton por `(businessId, type)` (excluyendo tipos multi-registro)

Se propone un `@@unique([businessId, type])` para forzar **una sola conexión por tipo por negocio**,
**excepto** los tipos que legítimamente admiten múltiples registros (webhooks, idempotencia, OTP).
Como Prisma no soporta índices únicos parciales de forma nativa, iría como índice parcial SQL a mano.

Dedup previo (detectar duplicados a resolver manualmente):

```sql
-- 1) Detectar negocios con más de una conexión del mismo type (fuera de los exentos)
SELECT "businessId", "type", COUNT(*) AS n
FROM "connections"
WHERE "type" NOT IN ('webhook', 'idempotency', 'otp')
GROUP BY "businessId", "type"
HAVING COUNT(*) > 1;

-- 2) (Tras revisión manual) conservar la más reciente/activa y borrar el resto.
--    Revisar cada caso antes de ejecutar un DELETE.
```

Restricción propuesta (NO aplicar aún — índice único parcial):

```sql
CREATE UNIQUE INDEX "connections_businessId_type_singleton_uidx"
  ON "connections" ("businessId", "type")
  WHERE "type" NOT IN ('webhook', 'idempotency', 'otp');
```

### B. `Promotion` código único por negocio `(businessId, code)`

Hoy `Promotion.code` es `@unique` global. Debería ser único **por negocio**
(`@@unique([businessId, code])`) y dejar de ser único global.

Dedup previo:

```sql
-- Detectar (businessId, code) repetidos
SELECT "businessId", "code", COUNT(*) AS n
FROM "promotions"
WHERE "code" IS NOT NULL
GROUP BY "businessId", "code"
HAVING COUNT(*) > 1;
```

Restricción propuesta (NO aplicar aún):

```sql
-- Primero quitar el unique global de code, luego:
ALTER TABLE "promotions"
  ADD CONSTRAINT "promotions_businessId_code_key" UNIQUE ("businessId", "code");
```

### C. Cliente único por negocio/teléfono `(businessId, phone)` en `User`

Se propone `@@unique([businessId, phone])` para evitar clientes duplicados por teléfono dentro de
un mismo negocio. Nota: `phone` es nullable; un índice único trata múltiples `NULL` como distintos
en PostgreSQL, pero conviene decidir la política (índice parcial `WHERE phone IS NOT NULL`).

Dedup previo:

```sql
SELECT "businessId", "phone", COUNT(*) AS n
FROM "users"
WHERE "phone" IS NOT NULL
GROUP BY "businessId", "phone"
HAVING COUNT(*) > 1;
```

Restricción propuesta (NO aplicar aún):

```sql
CREATE UNIQUE INDEX "users_businessId_phone_uidx"
  ON "users" ("businessId", "phone")
  WHERE "phone" IS NOT NULL;
```

### D. CHECK `stock >= 0` en `Product`

Evita stock negativo. Falla si ya hay filas con `stock < 0`.

Dedup / corrección previa:

```sql
-- Detectar stock negativo
SELECT "id", "businessId", "name", "stock" FROM "products" WHERE "stock" < 0;

-- (Tras revisión) corregir, p. ej. llevar a 0:
-- UPDATE "products" SET "stock" = 0 WHERE "stock" < 0;
```

Restricción propuesta (NO aplicar aún):

```sql
ALTER TABLE "products"
  ADD CONSTRAINT "products_stock_non_negative" CHECK ("stock" >= 0);
```

> Prisma no modela CHECK constraints de forma nativa; este CHECK iría en una migración SQL manual.
