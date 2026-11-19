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
| 1.3 | `ai/engine.ts` `upsertConfig` sin tx ni lock: pisa API keys cifradas. **Hecho:** tx + `pg_advisory_xact_lock` por (negocio, tipo) | `services/ai/engine.ts` ~91-114 | S |
| 1.4 | Telegram: `findUnique({id})` sin `businessId` (cross-tenant). **Hecho:** las búsquedas de reserva ahora filtran por `businessId` (verificado 2026-11-15; el `findUnique` que queda es por email, con `businessId` embebido) | `services/telegram/conversations.ts` (antes 83,169,220,290,332) | S |
| 1.5 | Loaders de `Connection.config` sin `orderBy` (fila no determinística) | todos los `load*` | S |
| 1.6 | Timeout 20 s del cliente vs loop de Mr Go + `ejecutarEnVivo`: riesgo de acción duplicada. **Parcial:** el timeout por llamada de IA ya es de 120 s (`AI_CALL_TIMEOUT_MS`); el header `Idempotency-Key` para EN VIVO está en el cliente (lado servidor no verificado) | `apps/web/src/lib/api/mrgo.ts` ~161; `apps/web/src/lib/api/http-client.ts:7` (línea no verificada) | M |
| 1.7 | Timeout/`maxRetries` explícitos en clientes Anthropic/OpenAI. **Parcial:** los providers ya los tienen (`providers/anthropic.ts:27`, `providers/openai.ts:57-61`). **Pendiente:** el cliente OpenAI de Whisper no tiene timeout ni `maxRetries` (la descarga del audio sí tiene `AbortSignal.timeout`) | `services/ai/transcription.ts` ~32 y ~66 | S |

## Ola 2 — Lecturas en el camino caliente (mayor ganancia de latencia)
| # | Qué | Dónde | Tam. |
|---|-----|-------|------|
| 2.1 | Loader batcheado y cacheado de `Connection` (`findMany type IN`, TTL 15–30 s, invalidación al guardar). Baja de ~16 a ~8 queries por mensaje de chat y de ~8 a ~2 lecturas en `/mrgo/run` | `chatbot.ts`, `ai/engine.ts`, `mrgo/orchestrator.ts`, `agent-loop.ts` | M |
| 2.2 | `requireCapability`: caché del plan y de los overrides (1–4 queries por request) | `middleware/capability.ts`, `team/permissions.ts` | S |
| 2.3 | `dispatchEvent`: salir temprano si no hay reglas que matcheen. **Hecho, sin caché:** `dispatchEvent` solo encola (ver 4.2); el worker lee las reglas y corta si ninguna matchea, sin caché de reglas | `services/workflows/index.ts` ~482-513 (corte temprano ~505-506) | S |
| 2.4 | Analytics: `groupBy` / `date_trunc` en SQL + caché 30–60 s. **Hecho:** agregados con `$queryRaw` (día de Argentina) y `cacheResponse(30_000)` | `routes/analytics.ts` ~31 (TTL), ~164-522 (queries) | M |
| 2.5 | Meta: `findFirst` con `config path` en vez de leer todos los tenants. **Hecho:** `findMany` con filtro por `path` en la DB; el chequeo en JS queda como red de seguridad | `services/meta/client.ts` ~168-177 y ~287 | S |
| 2.6 | `Promise.all` para lecturas independientes del chat | `chatbot.ts` | S |

## Ola 3 — Multi-instancia (Redis, sin schema)
| # | Qué | Dónde | Tam. |
|---|-----|-------|------|
| 3.1 | Telegram: estado de la reserva en Redis. **Hecho:** clave `tg-booking:<id del bot>:<chat>` con TTL de 30 min renovado en cada set (antes `bizId:chatId` / 15 min) | `services/telegram/conversations.ts` ~31-51 | S |
| 3.2 | Telegram: bot on-demand desde la DB con LRU, sin restaurar todo al boot. **Parcial:** los bots son on-demand con LRU de 500 (`MAX_ACTIVE_BOTS`, `bot.ts:23`). **Pendiente:** `restoreActiveBots` sigue leyendo todas las conexiones TELEGRAM y re-registrando webhooks en cada arranque; lo hace una sola instancia por vez gracias al lock Redis de 10 min | `services/telegram/bot.ts:23`, ~173-212 | M |
| 3.3 | Contadores de costo/abuso (chat público, OTP, ManyChat) a Redis `INCR`+`EXPIRE` (modelo: `redisAllow`). **Parcial:** **pendiente** el OTP de chat público: `publicChat.ts` ~585-609 lee el contador con `sharedGet`, envía y recién después hace `sharedIncr`, así que hay una ventana de carrera que deja pasar pedidos simultáneos. Los rangos originales de `publicChat.ts` y `manychat.ts` no se re-verificaron | `publicChat.ts` ~585-609 (ver también 35-57, 375-399); `manychat.ts:64-87` (no verificado) | S |
| 3.4 | Lock para el scheduler (hoy depende de `RUN_SCHEDULER=false` a mano). **Hecho:** cada cron toma un lock por (job, día) con `runExclusive` y `sharedTryLock` de 23 h; `RUN_SCHEDULER=false` quedó opcional. Es un lock por job y día, **no un líder**. Falla abierto: si Redis cae, `sharedTryLock` devuelve `true` y el job corre en cada instancia. El día de la clave sale de `toISOString()` (UTC), mientras analytics usa el día de Argentina: la clave cambia a las 21:00 hora de Argentina | `services/scheduler.ts` ~201-208; `lib/sharedState.ts` ~117 | S |
| 3.5 | Caché de cuota/revocación/stats compartido (hoy por instancia) | `lib/cache.ts`, `billing/quota.ts`, `auth/revocation.ts` | M |
| 3.6 | Cliente socket `transports: ['websocket']` o sticky sessions en el LB; `TRUST_PROXY_HOPS` documentado. **Pendiente en el código:** el default sigue `websocket,polling`; solo se cambia a websocket con `NEXT_PUBLIC_SOCKET_TRANSPORTS=websocket` en el build. **Hecho:** `TRUST_PROXY_HOPS` documentado | `apps/web/src/hooks/use-socket.ts` ~13-23; `apps/server/src/index.ts` ~116; `DEPLOY.md` ~220-229 | S |

## Ola 4 — Colas y workers (BullMQ sobre el Redis existente)
| # | Qué | Dónde | Tam. |
|---|-----|-------|------|
| 4.1 | Webhooks WhatsApp/Meta/ManyChat/voz: responder 200 de inmediato y encolar; `jobId = MessageSid / mid` para deduplicar. **Colas en uso para WhatsApp, Meta y Telegram** (`whatsapp-inbound`, `meta-inbound`, `telegram-update`; la respuesta 200 inmediata y el dedupe por `jobId` no se re-verificaron en esta pasada); ManyChat y voz siguen síncronos por diseño | `routes/whatsapp.ts` ~95-160, `meta.ts` ~87-157 | L |
| 4.2 | `dispatchEvent` y notificaciones `void sendXxx` a cola con reintentos. **Parcial:** solo `dispatchEvent` va a cola (`workflow-event`). **Pendiente:** los `void sendXxx` siguen sin cola ni reintentos en `bookings.ts` (líneas 85, 179, 183) y `orders.ts` (238, 287) | `workflows/index.ts` (hecho); `bookings.ts` 85, 179, 183; `orders.ts` 238, 287 | M |
| 4.3 | Campañas: estados `sending/sent`, lotes con checkpoint por destinatario. **Parcial:** hay cursor en `sharedSet` por campaña y reintentos del job (no re-verificado en detalle) | `campaigns/send.ts` | M |
| 4.4 | Límite de concurrencia y cuota por tenant en endpoints de IA (incluido `/mrgo/*`). **Parcial:** hecho un tope de llamadas por minuto por negocio (`tenantRateLimit`, ventana fija vía `sharedIncr`, `middleware/tenantRateLimit.ts`), usado en `mrgo.ts` (`/orchestrate` 30, `/run` 12, `/confirm` 12), `ai.ts` (`/chat` 60, `/generate-prompt` 10) y `catalogFeatures.ts` (30). **Pendiente:** límite de concurrencia en vuelo y cuota mensual en esas rutas | `routes/mrgo.ts` ~198, 232, 268; `ai.ts` ~52, 74; `catalogFeatures.ts` ~70 | M |
| 4.5 | Scheduler: un job por tenant en cola, concurrencia 5 (HECHO: cola `scheduler-business`, jobId por tipo+negocio+día, reintentos con Redis: cantidad no verificada). Ver también 3.4 | `services/scheduler.ts` ~157-173 | M |

**Colas reales hoy (verificado 2026-11-15):** `scheduler-business` (concurrencia 5), `telegram-update` (10), `whatsapp-inbound` (10), `meta-inbound` (10), `workflow-event` (5), `campaign-send` (2). Todas se definen con `defineQueue` en `lib/queue.ts`.

## Ola 5 — Frontend
| # | Qué | Dónde | Tam. |
|---|-----|-------|------|
| 5.1 | Oficina: aislar piso (`useOfficeLife` + `OfficeFloor`) en subárbol con `memo`; Studio y Memoria a componentes con estado local; `memo` en `MrGoAvatar`/`AgentView`; drag con ref y persistir en `pointerup` | `oficina/page.tsx`, `components/mrgo/*` | M |
| 5.2 | Assets: miniaturas 64–128 px en WebP, `alive={false}` en tarjetas/lista, Studio diferido, borrar `office/room.png` si no se usa | `public/mrgo` (4,6 MB) | M |
| 5.3 | Notificaciones: un solo provider, evento por socket, polling solo de respaldo y pausado en `hidden`. **Parcial:** `use-notifications.ts` ya pausa el polling en `hidden` (línea 68). **Pendiente:** `Sidebar.tsx` tiene su propio `setInterval` de 30 s sin pausa, así que hay dos pollers | `components/dashboard/Sidebar.tsx` ~53; `hooks/use-notifications.ts` ~53, 68 | S |
| 5.4 | Inbox: paginación o infinite scroll, búsqueda server-side, mensajes con cursor ("cargar anteriores") | `conversaciones/page.tsx` | M |
| 5.5 | Clientes: debounce 300 ms, sacar el funnel del efecto de búsqueda, `AbortController`. **Parcial:** el debounce de 300 ms ya está en `clientes/page.tsx` (~64-70). **Pendiente:** no hay `AbortController` en `use-clients.ts` (sacar el funnel del efecto no verificado) | `clientes/page.tsx` ~64-70; `hooks/use-clients.ts` | S |
| 5.6 | `next/dynamic` para `WebChat`, Studio y pestañas pesadas. **Parcial:** solo `WebChat` es lazy (`components/chat/LazyWebChat.tsx`, usado en `(dashboard)/layout.tsx:22`). Studio y pestañas pesadas no usan `next/dynamic` | `(dashboard)/layout.tsx:22` | S |
| 5.7 | Dedupe de GET en vuelo en `httpClient` (o TanStack Query) | `lib/api/http-client.ts` | M |

## Ola 6 — Límites del JSON único por negocio
| # | Qué | Tam. |
|---|-----|------|
| 6.1 | Tope de entradas y poda en CRM / lifecycle / revocación de sesiones (hoy crecen sin límite y se reescriben enteros bajo lock) | M |
| 6.2 | Advisory lock en la creación inicial de `Connection` (`findFirst`+`create` duplica filas) | S |
| 6.3 | Purga por TTL de idempotencia y OTP vencidos (y, en curso, de cobros de MercadoPago) | S |
| 6.4 | A más largo plazo: filas hijas por cliente (`CLIENT_CRM_ITEM`) en vez de un mapa gigante | L |

**Estado:** 6.1 y 6.2 hechos; 6.3 hecho para OTP e idempotencia, MercadoPago en curso; 6.4 queda pendiente (requiere descongelar el schema).
- 6.1: revocación de sesiones poda cortes más viejos que la vida del JWT (`JWT_EXPIRES_IN`; si el formato no se entiende, no poda). CRM (10.000 clientes) y lifecycle (20.000) tienen tope solo al **sumar** clientes: antes de rechazar con 409 podan clientes borrados; nunca recortan datos existentes.
- 6.2: `lib/singletonLock.ts` toma un advisory lock por (negocio, type) al inicio de cada transacción que hace `findFirst`+`create` de una `Connection` singleton. Hoy son **37 llamadas a `lockSingleton` en 29 archivos** (verificado 2026-11-15). `routes/meta.ts` (alta de página/IG) también quedó cubierto.
- 6.3: `services/maintenance/purge.ts`, cron 04:00 con lock por día: OTP vencidos hace más de 1 h y claves de idempotencia de más de 30 días (`IDEMPOTENCY_TTL_DAYS`). Tipos cubiertos en el código commiteado: `ORDER`/`TRANSACTION`/`MRGO_IDEMPOTENCY` y `BOOKING_OTP`. **En curso (sin commitear):** `purge.ts` ya agrega `MERCADOPAGO_COBRO` y `MERCADOPAGO_PAYMENT` (TTL 180 días, `MP_ROWS_TTL_DAYS` en `services/mercadopago/cobros.ts`), porque cada cobro y cada pago generan una fila nueva que hoy no se borra. `Connection` no tiene `createdAt` (schema congelado); la antigüedad sale de la fecha embebida en el id cuid.

## Estado general (actualizado 2026-11-15)

| Ola | Estado | Commit |
|---|---|---|
| 1 Bugs y correctitud | Hecha (1.6 y 1.7 con pendientes, ver filas) | `b93daee` |
| 2 Lecturas en el camino caliente | Hecha, con diferidos (2.1 loader cacheado de `Connection`; 2.3 sin caché de reglas) | `1fcba71` |
| 3 Multi-instancia (Redis) | Parcial: diferidos 3.5 (cuota/revocación compartidas); pendientes 3.2 (restore de webhooks al boot), 3.3 (OTP con ventana de carrera) y 3.6 (transports por defecto) | `14f96c8` |
| 4 Colas BullMQ | Parcial: colas en uso (ver lista de la ola); 4.2 solo en `dispatchEvent`; 4.4 solo tope por minuto (faltan concurrencia en vuelo y cuota mensual); ManyChat y voz siguen síncronos por diseño | `fc17a3e` |
| 5 Frontend | Parcial: 5.3 con dos pollers de notificaciones; 5.5 sin `AbortController`; 5.6 solo `WebChat` es lazy | `37e6a9d` |
| 6 Límites del JSON por negocio | 6.1 y 6.2 hechas; 6.3 hecha para OTP e idempotencia (MercadoPago en curso); 6.4 requiere descongelar el schema | `24dcaf5` |

Trabajo posterior a las olas:
- Analytics agregado en SQL y por día de Argentina (`/conversations`, `/timeseries`, `/attribution`): `c33f70c`.
- `GET /campaigns/recipients`: conteo en la DB y vista previa de 50: `8f660ca`.
- Lock de creación en `routes/meta.ts`: `3dc91b1`.
- DEPLOY.md y `.env.example` con el escalado multi-instancia: `6206693`.
- Seguridad: `npm audit fix` (next 16.4.6, dompurify, body-parser, follow-redirects): `a1d9354`; límite de cuerpo de 100 KB en rutas públicas (mitiga el aviso de zod): `93db187`. Siguen abiertos zod 3→4 y node-cron/uuid (saltos mayores).
- Índices aplicados en la base real: commit `7ef2890` (ver sección de migraciones).

**Hallazgo de la base real (2026-11-13), actualizado 2026-11-14:** 27 de los 52 índices que declara el schema no existían en Supabase (incluidos 3 UNIQUE). El 2026-11-14 se aplicaron los 27 faltantes y 3 índices nuevos (2 de alta sobre `businesses` y el UNIQUE parcial de singleton). Según el commit `7ef2890` y los encabezados de los SQL en `docs/migraciones/`, esto está aplicado en la base real; la verificación en la base la hizo el dueño y no se re-consultó en esta revisión (no verificado en esta pasada). El encabezado de `indices-faltantes-schema.sql` tiene además una línea "NO APLICADO" que contradice la línea "APLICADO" de arriba: hay que corregirla. Los SQL siguen en `docs/migraciones/indices-faltantes-schema.sql` y `docs/migraciones/indices-propuestos.sql`.

## Campañas y conversaciones: garantías anti-duplicado (verificado contra el código el 2026-11-17)

Sin cambios de schema: todo se apoya en `sharedState` (Redis, con fallback en memoria) y en locks de Postgres.

**Campañas (`services/campaigns/send.ts`, `dispatch.ts`, `events.ts`)**
- **Claim atómico:** pasar a `sending` es un `UPDATE ... WHERE status` (manual: no `sent`/`sending`/`cancelled`; scheduler: `scheduled` con fecha vencida). Solo una instancia gana; la otra recibe 400/404 y el scheduler lo cuenta como `skipped`.
- **`runId` por envío:** cada envío nuevo genera un `runId`, lo guarda como "envío vigente" (`sharedSet`, TTL 24 h) y lo viaja en el job. El cursor de progreso (a quién ya se le envió) es propio de ese `runId`. Un job viejo que sigue vivo (campaña reaped, cancelada, borrada o reenviada) comprueba el `runId` antes de cada lote, se corta solo y no toca el estado de la campaña: así un reenvío no duplica mensajes. Los jobs encolados sin `runId` (versión anterior) siguen funcionando con el cursor sin sufijo.
- **Latido de 60 s:** mientras envía, el job toca `updatedAt` de la campaña al menos cada 60 s (además de reflejar `sentCount` cada 25 destinatarios), para que un envío lento pero vivo no parezca trabado. Si el latido no encuentra la fila en `sending`, el job se corta.
- **Reaper de 30 min:** en cada tick del scheduler (`dispatchDueCampaigns`, bajo el lock de ese minuto) las campañas `sending` sin avance hace más de 30 min pasan a `failed`. El `UPDATE` incluye el `updatedAt` leído, así que si avanzó entre el listado y el pase no se pisa. Tope de 50 por tick.
- **Expiración:** una campaña `scheduled` con más de 6 h de atraso pasa a `failed` en vez de enviarse; el `UPDATE` incluye `scheduledAt` para no pisar una reprogramación hecha entre el listado y el pase.
- **Evento `campaign:failed`:** cada pase a `failed` emite `campaign:failed` a la sala `business:<id>` (`reason`: `retries_exhausted`, `expired`, `stalled` o `error`). Solo emite quien ganó el `UPDATE`, así que varias instancias no duplican el evento. Es best-effort y nunca lanza.
- **Edición y borrado:** `PATCH` no puede fijar `sent` ni `sending`, ni programar sin fecha; `DELETE` de una campaña `sending` responde 409.
- **Evento `campaign:progress`:** se emite junto con el latido (cada 25 destinatarios o 60 s) con `{ campaignId, progress: { enviados, fallidos, procesados, total } }`. No lee la DB, solo emite si el latido confirmó que el envío sigue vigente, y nunca lanza.
- **Pendiente:** recuperar automáticamente una campaña `failed` a mitad de envío (hoy el dueño decide reenviarla) y un `failureReason` persistido (requiere cambio de schema).

**Conversaciones (`services/chatbot.ts`, `services/channels/inboundRetry.ts`)**
- **Una conversación por contacto:** el alta es "buscar y, si no hay, crear". Como el schema no tiene `UNIQUE`, se serializa con un advisory lock transaccional por (negocio, canal, contacto) (`lockSingleton`, clave `conv-create:<canal>:<contacto>`) y se vuelve a buscar adentro con el lock tomado. Dos mensajes simultáneos del mismo contacto (dos webhooks, un reintento) comparten conversación. La búsqueda exige el mismo `realChannel`, así que voz, chat web y Messenger, que comparten el enum `WEBCHAT`, no se mezclan.
- **`externalId` idempotente:** el mensaje del cliente se guarda con el id del canal (`MessageSid` o `mid`) en `Message.metadata.externalId`. Si el mismo `externalId` ya existe en esa conversación, se reutiliza el mensaje en vez de duplicarlo. El reintento de un webhook que falló decide con ese id si ya se persistió algo (`wasAnythingPersisted`); sin `externalId` (canales que no lo traen) cae al criterio conservador anterior.
- **Respuestas humanas:** `POST /api/conversations/:id/reply` acepta `Idempotency-Key`, y un envío fallido se reintenta sin crear un mensaje nuevo (ver `docs/API.md`).

## Migraciones gateadas (requieren PR + migración, el schema sigue congelado hasta aprobarlo)
Borradores en `docs/migraciones/` (ver arriba). Los índices de expresión sobre JSON siguen pendientes de validar con `EXPLAIN` sobre datos realistas.
- Índices `businesses(phone)` y `businesses(whatsappNumber)` (alta): figuran aplicados (sección 1 de `indices-propuestos.sql`, según su encabezado y el commit `7ef2890`; no verificado en la base en esta pasada).
- Índices de expresión en `connections`: `config->>'pageId'`, `config->>'igId'`, `config->>'key'` (idempotencia), `config->>'phone'` (OTP). **Pendientes.**
- UNIQUE parcial `(businessId, type)` para tipos singleton (`connections_singleton_per_business_uidx`): figura aplicado (sección 3 de `indices-propuestos.sql`). **Riesgo no verificado:** el manejo de P2002 en las ~37 llamadas a `lockSingleton` (29 archivos). El `errorHandler` traduce P2002 de forma genérica (`middleware/errorHandler.ts:37`), pero no se revisó sitio por sitio.
- Media (pendiente, sección 2 de `indices-propuestos.sql`): `conversations(metadata->>'subscriberId')`, `skills(name, isActive)`, `messages(conversationId, role, createdAt)`.
- Baja: GIN trigram en `users(name, email)`, GIN en `conversations.metadata`.
- Los índices de expresión van en SQL crudo y no se declaran en `schema.prisma`: revisar el riesgo de drift con `prisma migrate`.

## Infra / configuración (decisión del dueño, no es código)
- Fijar `connection_limit` en la `DATABASE_URL` de producción; agrupar o serializar las queries paralelas de `/stats` (`/overview` tiene 10 y `/stats/health` tiene 12); `prisma.$disconnect()` en el shutdown: **sigue ausente** (`index.ts` ~384-406 solo tiene el `forceExit` de 10 s).
- Confirmar `REDIS_URL`, número de réplicas, sticky sessions y `TRUST_PROXY_HOPS` en el entorno desplegado.
- `.env` local de `apps/server`: tiene la `DATABASE_URL` de Supabase en texto plano. Está en `.gitignore` y no está trackeado; rotar la contraseña solo si alguna vez se compartió.

## Deuda técnica nueva (detectada en la revisión del 2026-11-15)
- `services/campaigns/send.ts` ~58 y ~133: el Map `inlineResults` se llena al terminar cada envío, pero solo se vacía al leerlo en la ruta inline (~105-106). Con colas reales nadie lo lee, así que crece una entrada por campaña.
- Lua duplicado: `middleware/rateLimit.ts` ~53-62 y `lib/sharedState.ts` ~19-21 tienen el mismo script (INCR + PEXPIRE).
- Locks inline repetidos: `pg_advisory_xact_lock` aparece en 16 archivos de servicio/rutas (incluido el helper `singletonLock.ts`), sin un helper común para los locks inline. Lista detallada no incluida en esta revisión.
- Patrón `load`/`findFirst` + lock + `create` copiado en 29 archivos (verificado, ver 6.2). Es el candidato natural a un helper único, que además sería el punto para el 2.1 diferido.

## Qué falta verificar antes de comprometer números
- Medir con carga real: tamaño de pool, latencia p95 de `/chat` y `/mrgo/run`, First Load JS (`next build`).
- Metas de escala del dueño: tenants a 12 meses, mensajes por día, p95 objetivo. Hasta tenerlas, este plan está ordenado por riesgo y retorno, no por cifras.

## Estado verificado el 2026-11-15
Esta revisión se hizo contra el código de hoy (2026-11-15), en modo solo lectura: Grep y Read sobre el código, sin ejecutar tests, sin EXPLAIN y sin consultar la base real. Las filas 1.1, 1.2, 1.5, 2.1, 2.2, 2.6, 3.5, 5.1, 5.2, 5.4, 5.7 y 6.4 no se re-verificaron en esta pasada y quedan como estaban. Los números de línea que no se pudieron confirmar están marcados "(no verificado)". El estado de los índices viene del commit `7ef2890` y de los encabezados de los SQL, no de una consulta a la base.
