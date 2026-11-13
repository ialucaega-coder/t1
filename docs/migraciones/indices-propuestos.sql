-- =====================================================================
-- BORRADOR de migración de índices (Ola de escalabilidad) — NO APLICADO
-- =====================================================================
-- Estado: propuesta para PR. El schema de Prisma está congelado: nada de esto
-- se aplica sin aprobación del dueño. No se tocó prisma/.
--
-- Cómo aplicarlo cuando se apruebe:
--  * CREATE INDEX CONCURRENTLY no corre dentro de una transacción ni en un
--    archivo multi-sentencia de `prisma migrate`. Ejecutar UNA sentencia por vez
--    (SQL editor de Supabase) y luego registrar la migración vacía/baseline.
--  * Todas son IF NOT EXISTS: se pueden repetir.
--  * Las tablas son chicas hoy; con tráfico real CONCURRENTLY evita bloquear escrituras.
--  * NO pude verificar los índices existentes en la base (la conexión rechazó al
--    revisar). Antes de aplicar: SELECT indexdef FROM pg_indexes WHERE tablename IN
--    ('businesses','connections','conversations','skills','messages');

-- ---------------------------------------------------------------------
-- 1) ALTA — businesses(phone), businesses(whatsappNumber)
-- Consulta: services/whatsapp/client.ts y services/voice/client.ts, en CADA mensaje
-- de WhatsApp / llamada:  WHERE isActive AND (phone = $1 OR whatsappNumber = $1)
--   ORDER BY createdAt LIMIT 1   → hoy seq scan. Con un índice por columna el
-- planner usa BitmapOr. Parciales: la mayoría de los negocios no tiene uno de los dos.
-- ---------------------------------------------------------------------
CREATE INDEX CONCURRENTLY IF NOT EXISTS businesses_phone_idx
  ON "businesses" ("phone") WHERE "phone" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS businesses_whatsapp_number_idx
  ON "businesses" ("whatsappNumber") WHERE "whatsappNumber" IS NOT NULL;

-- ---------------------------------------------------------------------
-- 2) MEDIA — índices simples sobre columnas reales
-- (ver "validar con EXPLAIN" abajo para los de JSON)
-- ---------------------------------------------------------------------
-- messages: hilo por conversación (cursor del inbox: orderBy createdAt desc, id desc).
-- Si ya existe (conversationId, createdAt) este es redundante: revisar antes.
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS messages_conversation_created_idx
--   ON "messages" ("conversationId", "createdAt" DESC, "id" DESC);

-- ---------------------------------------------------------------------
-- 3) UNIQUE parcial — una sola fila por (negocio, type) en los tipos singleton
-- Cierra del todo la carrera de duplicados (el advisory lock de la Ola 6 ya la
-- evita en la app; esto la garantiza también ante otros escritores).
--
-- PASO PREVIO OBLIGATORIO: si hay duplicados, la creación del índice falla.
-- Detectarlos:
--   SELECT "businessId", type, count(*) FROM "connections"
--   WHERE type IN (<lista de abajo>) GROUP BY 1,2 HAVING count(*) > 1;
-- Los lectores toman la fila de id menor; resolver conservando esa (y fusionando a
-- mano lo que tenga la otra) antes de crear el índice.
--
-- OJO: NO incluir tipos con varias filas legítimas por negocio (idempotencia,
-- BOOKING_OTP, conexiones de canal tipo Telegram/Meta).
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS connections_singleton_per_business_uidx
  ON "connections" ("businessId", "type")
  WHERE "type" IN (
    'AI_ENGINE','AUTOMATION_SETTINGS','BRAND','CALCOM','CLIENT_CRM','COMPOSIO',
    'CRM_LIFECYCLE','FAQ_KB','GALLERY','INTEGRATION_REQUESTS','MANYCHAT','MERCADOPAGO',
    'MRGO_AGENTS','MRGO_INDUSTRY','MRGO_MEMORY','MRGO_OFFICE','ONBOARDING',
    'PLATFORM_FEATURE_FLAGS','SESSION_REVOCATION','SYSTEM_PROMPT','TEAM_PERMISSIONS',
    'VOICE','WA_TEMPLATES','WHITELABEL_UI','WORKFLOWS'
  );
-- Efecto colateral a vigilar: un `create` concurrente que antes duplicaba ahora
-- lanza P2002. Los 24 sitios con lockSingleton ya serializan, así que no debería
-- ocurrir; routes/meta.ts (sin lock) no usa estos tipos.

-- ---------------------------------------------------------------------
-- 4) A VALIDAR con EXPLAIN antes de aplicar (no incluidos como definitivos)
-- Prisma traduce `config: { path: ['k'], equals: v }` a una comparación jsonb por
-- path (`config #> '{k}'`), NO a `config->>'k'`. Un índice de expresión solo se
-- usa si la expresión coincide. Pasos: capturar el SQL real con
-- `DEBUG=prisma:query`, correr EXPLAIN, y recién ahí crear el índice que coincida.
--   - connections: config pageId / igId (routes/meta.ts, services/meta/client.ts)
--   - connections: config key (idempotencia) y config phone (OTP)
--   - conversations: metadata subscriberId (ManyChat)
--   - skills(name, isActive)
-- Candidato (ejemplo, a confirmar):
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS connections_cfg_pageid_idx
--     ON "connections" (("config" #> '{pageId}')) WHERE "config" ? 'pageId';
-- Búsqueda de inbox por nombre/teléfono/email con `contains` insensible: si el
-- volumen lo pide, GIN trigram (requiere CREATE EXTENSION pg_trgm; no verificado).
-- ---------------------------------------------------------------------
