# Plan de escalabilidad — Mr. Go Assistance + Mr Go

Origen: 3 auditorías de solo lectura (acceso a datos, infra, frontend). Todo es lectura estática de código: no hay EXPLAIN, ni carga real, ni valores de producción (`REDIS_URL`, `connection_limit`, réplicas, sticky sessions). Los impactos son estimaciones.

Restricciones: schema Prisma congelado (todo lo que requiera índice de expresión o UNIQUE parcial entra por la vía gateada PR + migración), sin tablas nuevas, estado en `Connection.config` / Redis.

Tamaños: S = horas, M = 1–2 días, L = varios días.

## Ya está bien (no tocar)
- Socket.io con adaptador Redis, rooms por negocio, JWT en el handshake.
- Rate limit compartido con script Lua si hay `REDIS_URL`.
- Transacciones cortas, sin I/O externo adentro; advisory locks `pg_advisory_xact_lock`.
- Listados principales paginados; exports CSV acotados.
- `FOR UPDATE` por fila de negocio: no hay cuello de botella global.

## Ola 1 — Bugs y riesgos de correctitud (sin schema, bajo riesgo)
| # | Qué | Dónde | Tam. |
|---|-----|-------|------|
| 1.1 | Inbox: el spinner desmonta la pantalla en cada refetch del socket | `conversaciones/page.tsx:329`, `use-conversations.ts:19` | S |
| 1.2 | Inbox: debounce/coalescing del refetch por socket (300–500 ms) | `conversaciones/page.tsx:147-163, 239-245` | S |
| 1.3 | `ai/engine.ts` `upsertConfig` sin tx ni lock: pisa API keys cifradas | `services/ai/engine.ts:77-95` | S |
| 1.4 | Telegram: `findUnique({id})` sin `businessId` (cross-tenant) | `services/telegram/conversations.ts:83,169,220,290,332` | S |
| 1.5 | Loaders de `Connection.config` sin `orderBy` (fila no determinística) | todos los `load*` | S |
| 1.6 | Timeout 20 s del cliente vs loop de Mr Go + `ejecutarEnVivo`: riesgo de acción duplicada | `lib/api/mrgo.ts:211`, `http-client.ts:7` | M (timeout por llamada + idempotency key) |
| 1.7 | Timeout/`maxRetries` explícitos en clientes Anthropic/OpenAI | `services/ai/providers/*.ts` | S |

## Ola 2 — Lecturas en el camino caliente (mayor ganancia de latencia)
| # | Qué | Dónde | Tam. |
|---|-----|-------|------|
| 2.1 | Loader batcheado y cacheado de `Connection` (`findMany type IN`, TTL 15–30 s, invalidación al guardar). Baja de ~16 a ~8 queries por mensaje de chat y de ~8 a ~2 lecturas en `/mrgo/run` | `chatbot.ts`, `ai/engine.ts`, `mrgo/orchestrator.ts`, `agent-loop.ts` | M |
| 2.2 | `requireCapability`: caché del plan y de los overrides (1–4 queries por request) | `middleware/capability.ts`, `team/permissions.ts` | S |
| 2.3 | `dispatchEvent`: salir temprano si no hay reglas activas (cacheado) | `workflows/index.ts:392`, `settings.ts:41` | S |
| 2.4 | Analytics: `groupBy` / `date_trunc` en SQL + caché 30–60 s (hoy carga filas crudas) | `routes/analytics.ts:88-100, 420, 510` | M |
| 2.5 | Meta: `findFirst` con `config path` en vez de leer todos los tenants | `services/meta/client.ts:161, 274` | S |
| 2.6 | `Promise.all` para lecturas independientes del chat | `chatbot.ts` | S |

## Ola 3 — Multi-instancia (Redis, sin schema)
| # | Qué | Dónde | Tam. |
|---|-----|-------|------|
| 3.1 | Telegram: estado de la reserva en Redis (`bizId:chatId`, TTL 15 min) | `telegram/conversations.ts:31` | S |
| 3.2 | Telegram: bot on-demand desde la DB con LRU, sin restaurar todo al boot | `telegram/bot.ts:13, 81, 104` | M |
| 3.3 | Contadores de costo/abuso (chat público, OTP, ManyChat) a Redis `INCR`+`EXPIRE` (modelo: `redisAllow`) | `publicChat.ts:35-57, 375-399`, `manychat.ts:64-87` | S |
| 3.4 | Lock de líder en Redis para el scheduler (hoy depende de `RUN_SCHEDULER=false` a mano) | `services/scheduler.ts:178-205` | S |
| 3.5 | Caché de cuota/revocación/stats compartido (hoy por instancia) | `lib/cache.ts`, `billing/quota.ts`, `auth/revocation.ts` | M |
| 3.6 | Cliente socket `transports: ['websocket']` o sticky sessions en el LB; `TRUST_PROXY_HOPS` documentado | `use-socket.ts:13`, `index.ts:116` | S |

## Ola 4 — Colas y workers (BullMQ sobre el Redis existente)
| # | Qué | Dónde | Tam. |
|---|-----|-------|------|
| 4.1 | Webhooks WhatsApp/Meta/ManyChat/voz: responder 200 de inmediato y encolar; `jobId = MessageSid / mid` para deduplicar | `routes/whatsapp.ts:95-160`, `meta.ts:87-157` | L |
| 4.2 | `dispatchEvent` y notificaciones `void sendXxx` a cola con reintentos | `workflows/index.ts`, `bookings.ts`, `orders.ts` | M |
| 4.3 | Campañas: estados `sending/sent`, lotes con checkpoint por destinatario | `campaigns/send.ts` | M |
| 4.4 | Límite de concurrencia y cuota por tenant en endpoints de IA (incluido `/mrgo/*`) | `routes/mrgo.ts:173-279`, `ai.ts`, `catalogFeatures.ts` | M |
| 4.5 | Scheduler: un job por tenant en cola, concurrencia 5–10 | `services/scheduler.ts` | M |

## Ola 5 — Frontend
| # | Qué | Dónde | Tam. |
|---|-----|-------|------|
| 5.1 | Oficina: aislar piso (`useOfficeLife` + `OfficeFloor`) en subárbol con `memo`; Studio y Memoria a componentes con estado local; `memo` en `MrGoAvatar`/`AgentView`; drag con ref y persistir en `pointerup` | `oficina/page.tsx`, `components/mrgo/*` | M |
| 5.2 | Assets: miniaturas 64–128 px en WebP, `alive={false}` en tarjetas/lista, Studio diferido, borrar `office/room.png` si no se usa | `public/mrgo` (4,6 MB) | M |
| 5.3 | Notificaciones: un solo provider, evento por socket, polling solo de respaldo y pausado en `hidden` | `Sidebar.tsx:51`, `use-notifications.ts` | S |
| 5.4 | Inbox: paginación o infinite scroll, búsqueda server-side, mensajes con cursor ("cargar anteriores") | `conversaciones/page.tsx` | M |
| 5.5 | Clientes: debounce 300 ms, sacar el funnel del efecto de búsqueda, `AbortController` | `clientes/page.tsx:161`, `use-clients.ts` | S |
| 5.6 | `next/dynamic` para `WebChat`, Studio y pestañas pesadas | `(dashboard)/layout.tsx:22` | S |
| 5.7 | Dedupe de GET en vuelo en `httpClient` (o TanStack Query) | `lib/api/http-client.ts` | M |

## Ola 6 — Límites del JSON único por negocio
| # | Qué | Tam. |
|---|-----|------|
| 6.1 | Tope de entradas y poda en CRM / lifecycle / revocación de sesiones (hoy crecen sin límite y se reescriben enteros bajo lock) | M |
| 6.2 | Advisory lock en la creación inicial de `Connection` (`findFirst`+`create` duplica filas) | S |
| 6.3 | Purga por TTL de idempotencia y OTP vencidos | S |
| 6.4 | A más largo plazo: filas hijas por cliente (`CLIENT_CRM_ITEM`) en vez de un mapa gigante | L |

## Migraciones gateadas (requieren PR + migración, el schema sigue congelado hasta aprobarlo)
- Índices `businesses(phone)` y `businesses(whatsappNumber)` (alta): hoy es un seq scan por cada mensaje de WhatsApp o voz.
- Índices de expresión en `connections`: `config->>'pageId'`, `config->>'igId'`, `config->>'key'` (idempotencia), `config->>'phone'` (OTP).
- UNIQUE parcial `(businessId, type)` para tipos singleton: cierra la carrera de duplicados.
- Media: `conversations(metadata->>'subscriberId')`, `skills(name, isActive)`, `messages(conversationId, role, createdAt)`.
- Baja: GIN trigram en `users(name, email)`, GIN en `conversations.metadata`.
- Los índices de expresión van en SQL crudo y no se declaran en `schema.prisma`: revisar el riesgo de drift con `prisma migrate`.

## Infra / configuración (decisión del dueño, no es código)
- Fijar `connection_limit` en la `DATABASE_URL` de producción; agrupar o serializar las 14 queries paralelas de `/stats`; `prisma.$disconnect()` en el shutdown.
- Confirmar `REDIS_URL`, número de réplicas, sticky sessions y `TRUST_PROXY_HOPS` en el entorno desplegado.
- `.env` local de `apps/server`: tiene la `DATABASE_URL` de Supabase en texto plano. Está en `.gitignore` y no está trackeado; rotar la contraseña solo si alguna vez se compartió.

## Qué falta verificar antes de comprometer números
- Medir con carga real: tamaño de pool, latencia p95 de `/chat` y `/mrgo/run`, First Load JS (`next build`).
- Metas de escala del dueño: tenants a 12 meses, mensajes por día, p95 objetivo. Hasta tenerlas, este plan está ordenado por riesgo y retorno, no por cifras.
