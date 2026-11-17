-- ============================================================================
-- GATED — Deduplicación de datos + restricciones (uniques / CHECK)
-- ============================================================================
-- Estas restricciones NO se pueden aplicar mientras existan datos que las violen.
-- Este script: (0) DETECTA duplicados, (1-3) los DEDUPLICA/CORRIGE de forma
-- transaccional, y (4) AGREGA las restricciones. Lo corre el USUARIO contra la
-- DB (modifica datos). Está pensado para Postgres/Supabase.
--
-- ⚠️ ANTES DE CORRER:
--   1. Hacé un backup / snapshot de la DB (Supabase → Database → Backups).
--   2. Corré SOLO la sección 0 (detección) primero y revisá los resultados.
--   3. Recién entonces corré las secciones 1→4, en orden.
--   4. Corré contra la conexión DIRECTA (DIRECT_URL, puerto 5432), no el pooler.
--
-- Cada bloque de dedup va en su propia transacción (BEGIN/COMMIT): si algo falla,
-- hacé ROLLBACK y revisá. Son idempotentes: volver a correrlos no hace daño (ya
-- no quedan duplicados que resolver).
-- ============================================================================


-- ============================================================================
-- 0) DETECCIÓN (solo SELECT — no modifica nada). Revisá los resultados.
-- ============================================================================

-- 0.A Conexiones singleton duplicadas (más de una por (businessId, type),
--     EXCLUYENDO los tipos que legítimamente admiten varias filas).
SELECT "businessId", "type", COUNT(*) AS n
FROM "connections"
WHERE "type" NOT IN ('webhook', 'BOOKING_OTP', 'ORDER_IDEMPOTENCY', 'TRANSACTION_IDEMPOTENCY')
GROUP BY "businessId", "type"
HAVING COUNT(*) > 1
ORDER BY n DESC;

-- 0.B Clientes duplicados por (businessId, phone) (role=CLIENT, phone no nulo).
SELECT "businessId", "phone", COUNT(*) AS n
FROM "users"
WHERE "role" = 'CLIENT' AND "phone" IS NOT NULL
GROUP BY "businessId", "phone"
HAVING COUNT(*) > 1
ORDER BY n DESC;

-- 0.C Promociones con (businessId, code) repetido. Como `code` hoy es @unique
--     GLOBAL, esto normalmente devuelve 0 filas (no hay dups por negocio).
SELECT "businessId", "code", COUNT(*) AS n
FROM "promotions"
WHERE "code" IS NOT NULL
GROUP BY "businessId", "code"
HAVING COUNT(*) > 1
ORDER BY n DESC;

-- 0.D Productos con stock negativo (violarían el CHECK stock >= 0).
SELECT "id", "businessId", "name", "stock" FROM "products" WHERE "stock" < 0;


-- ============================================================================
-- 1) DEDUP de CONEXIONES singleton: conservar la "mejor" por (businessId, type)
--    y borrar el resto. "Mejor" = activa primero, luego config no vacía, luego
--    id más alto (más reciente). Las conexiones NO son referenciadas por FK de
--    otras tablas (son almacén de config), así que borrar las sobrantes es seguro.
-- ============================================================================
BEGIN;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "businessId", "type"
      ORDER BY
        ("isActive")::int DESC,                                  -- activas primero
        (CASE WHEN ("config")::text <> '{}' THEN 0 ELSE 1 END),  -- config no vacía primero
        id DESC                                                  -- más reciente
    ) AS rn
  FROM "connections"
  WHERE "type" NOT IN ('webhook', 'BOOKING_OTP', 'ORDER_IDEMPOTENCY', 'TRANSACTION_IDEMPOTENCY')
)
DELETE FROM "connections" c
USING ranked r
WHERE c.id = r.id AND r.rn > 1;

COMMIT;


-- ============================================================================
-- 2) MERGE de CLIENTES duplicados por (businessId, phone):
--    se elige un cliente CANÓNICO por grupo (el más antiguo: createdAt, luego id),
--    se repuntan TODAS las referencias (bookings, orders, notifications) al
--    canónico, y se borran los duplicados. Transaccional.
-- ============================================================================
BEGIN;

-- Tabla temporal con el mapeo dup_id → canonical_id.
CREATE TEMP TABLE _user_dedup ON COMMIT DROP AS
SELECT id AS dup_id, canonical_id
FROM (
  SELECT
    id,
    FIRST_VALUE(id) OVER (
      PARTITION BY "businessId", "phone"
      ORDER BY "createdAt" ASC, id ASC
    ) AS canonical_id
  FROM "users"
  WHERE "role" = 'CLIENT' AND "phone" IS NOT NULL
) ranked
WHERE id <> canonical_id;

-- Repuntar referencias al cliente canónico.
UPDATE "bookings" b
  SET "clientId" = d.canonical_id
  FROM _user_dedup d
  WHERE b."clientId" = d.dup_id;

UPDATE "orders" o
  SET "clientId" = d.canonical_id
  FROM _user_dedup d
  WHERE o."clientId" = d.dup_id;

UPDATE "notifications" n
  SET "userId" = d.canonical_id
  FROM _user_dedup d
  WHERE n."userId" = d.dup_id;

-- Borrar los clientes duplicados (ya sin referencias colgando).
DELETE FROM "users" u
  USING _user_dedup d
  WHERE u.id = d.dup_id;

COMMIT;


-- ============================================================================
-- 3) CORRECCIÓN de stock negativo (lleva a 0 lo que haya quedado en negativo
--    por el viejo bug de sobreventa, ya corregido en el código).
-- ============================================================================
BEGIN;
UPDATE "products" SET "stock" = 0 WHERE "stock" < 0;
COMMIT;


-- ============================================================================
-- 4) RESTRICCIONES (correr SOLO después de que las secciones 0→3 queden limpias).
--    Si alguna falla por "already exists" o por datos que todavía violan, revisá.
-- ============================================================================
BEGIN;

-- 4.A Conexión singleton: una por (businessId, type), excepto los multi-fila.
--     Índice único PARCIAL (Prisma no modela parciales; ver nota al final).
CREATE UNIQUE INDEX IF NOT EXISTS "connections_businessId_type_singleton_uidx"
  ON "connections" ("businessId", "type")
  WHERE "type" NOT IN ('webhook', 'BOOKING_OTP', 'ORDER_IDEMPOTENCY', 'TRANSACTION_IDEMPOTENCY');

-- 4.B Cliente único por (businessId, phone) (parcial: solo donde phone no es nulo).
CREATE UNIQUE INDEX IF NOT EXISTS "users_businessId_phone_uidx"
  ON "users" ("businessId", "phone")
  WHERE "phone" IS NOT NULL;

-- 4.C Promoción: código único POR NEGOCIO en vez de global.
--     Primero se quita el unique global de `code` y luego el compuesto.
--     NOTA: verificá el nombre real del constraint global con `\d promotions`
--     (Prisma lo nombra `promotions_code_key`).
ALTER TABLE "promotions" DROP CONSTRAINT IF EXISTS "promotions_code_key";
ALTER TABLE "promotions"
  ADD CONSTRAINT "promotions_businessId_code_key" UNIQUE ("businessId", "code");

-- 4.D Stock no negativo.
ALTER TABLE "products"
  ADD CONSTRAINT "products_stock_non_negative" CHECK ("stock" >= 0);

COMMIT;


-- ============================================================================
-- NOTAS PARA PRISMA (importante)
-- ============================================================================
-- • 4.A y 4.B son índices ÚNICOS PARCIALES (con WHERE). Prisma NO los modela en
--   el schema, así que un `prisma migrate dev` futuro podría proponer eliminarlos.
--   Mitigación: no usar `migrate dev` contra prod (usamos `migrate deploy`), y
--   dejar estos índices documentados acá. Si en el futuro se corre `migrate diff`,
--   revisar que no los borre.
-- • 4.C (Promotion) SÍ es expresable en el schema: en `prisma/schema.prisma`,
--   quitar `@unique` de `code` y agregar `@@unique([businessId, code])` al modelo
--   Promotion, y generar su migración con `prisma migrate diff` (como add_two_factor).
--   Si se hace eso, NO correr el bloque 4.C de acá (quedaría duplicado).
-- • 4.D (CHECK) tampoco lo modela Prisma; va como SQL manual (este archivo) o en
--   una migración SQL a mano. Mismo criterio de drift que 4.A/4.B.
-- ============================================================================
