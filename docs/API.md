# Referencia de la API

Documentación de referencia de la API HTTP del backend (Express + TypeScript, `apps/server`).
Se generó a partir del código fuente (`apps/server/src/index.ts` y `apps/server/src/routes/*.ts`); solo se documentan endpoints que existen realmente en el código.

## Introducción

- **URL base:** todos los endpoints cuelgan del prefijo `/api`. En desarrollo el servidor escucha en `http://localhost:4000` (configurable con la variable de entorno `PORT`), por lo que la URL base típica es `http://localhost:4000/api`. Las URLs completas de cada tabla incluyen el prefijo `/api`.
- **Autenticación (`Authorization: Bearer <token>`):** los endpoints protegidos usan un JWT que se obtiene de `POST /api/auth/login` o `POST /api/auth/register` (campo `token` de la respuesta). Ese token se envía en cada petición con el header `Authorization: Bearer <token>`. El middleware `requireAuth` lo valida; si falta o es inválido responde `401`. Además, al iniciar sesión se emite una cookie httpOnly `session_token` como defensa en profundidad.
- **Autorización por rol:** algunos endpoints requieren además el rol adecuado (middleware `requireRole`). Los roles posibles son `ADMIN`, `PROFESSIONAL` y `CLIENT`. Si el rol del token no alcanza, la respuesta es `403`. En las tablas, la columna **Rol** indica el rol mínimo exigido (`—` cuando cualquier usuario autenticado sirve).
- **Header `Idempotency-Key`:** los endpoints `POST /api/transactions` y `POST /api/orders` aceptan un header opcional `Idempotency-Key`. Si se reintenta la misma petición con la misma clave (por doble click o reintento de red), el servidor no duplica el registro: devuelve el recurso ya creado con estado `200` en lugar de `201`. La deduplicación está serializada con un advisory lock por (negocio, clave).
- **Multi-tenant por `businessId`:** cada usuario pertenece a un negocio (`businessId`, embebido en el JWT). Todas las consultas de datos están acotadas ("scoped") al `businessId` del token, de modo que un negocio nunca ve ni modifica datos de otro. El `businessId` no se envía en el body: se toma siempre del token.
- **Formato:** las peticiones y respuestas usan JSON (`Content-Type: application/json`), salvo los webhooks de Twilio (voz y WhatsApp), que llegan como `application/x-www-form-urlencoded`, y los webhooks de Meta/Stripe, que requieren el cuerpo crudo para validar la firma. Las respuestas de exportación `export/csv` devuelven `text/csv`.
- **Health check:** `GET /api/health` — endpoint público (sin auth) que responde `{ status: "ok", timestamp }`.

---

## Auth — `/api/auth`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| POST | /api/auth/register | No | — | Registra un negocio nuevo y su usuario ADMIN, devuelve el token. Body: `email`, `password`, `name`, `businessName`. |
| POST | /api/auth/login | No | — | Inicia sesión y devuelve el JWT (con bloqueo tras 5 intentos fallidos). Body: `email`, `password`. |
| GET | /api/auth/me | Bearer | — | Devuelve el usuario y negocio del token (valida el Bearer manualmente). |
| PATCH | /api/auth/me | Bearer | — | Actualiza nombre y/o contraseña del usuario autenticado. Body: `name?`, `currentPassword?`, `newPassword?`. |
| POST | /api/auth/logout | No | — | Cierra sesión: borra la cookie `session_token`. |

## Reservas / Turnos — `/api/bookings`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/bookings | Sí | — | Lista turnos del negocio (paginado). Query: `date?`, `status?`, `professionalId?`, `page`/`pageSize` o `limit`/`offset`. |
| POST | /api/bookings | Sí | — | Crea un turno con reserva atómica anti-solape por profesional. Body: `date`, `startTime` (HH:mm), `serviceId`, `professionalId`, `clientId?`, `notes?`, `source`. |
| GET | /api/bookings/export/csv | Sí | — | Exporta las reservas del negocio a CSV. |
| PATCH | /api/bookings/:id/status | Sí | — | Cambia el estado del turno y notifica al cliente. Body: `status`. |
| DELETE | /api/bookings/:id | Sí | ADMIN | Elimina un turno. |

## Servicios — `/api/services`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/services | Sí | — | Lista los servicios del negocio con categoría y profesionales. |
| POST | /api/services | Sí | ADMIN | Crea un servicio. Body: `name`, `duration`, `price`, `description?`, `categoryId?`, `isActive`. |
| PUT | /api/services/:id | Sí | ADMIN | Actualiza (parcial) un servicio. |
| DELETE | /api/services/:id | Sí | ADMIN | Elimina un servicio del negocio. |

## Productos — `/api/products`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/products | Sí | — | Lista los productos del negocio (paginado opcional). Query: `page`/`limit`/`offset`. |
| POST | /api/products | Sí | ADMIN | Crea un producto. Body: `name`, `price`, `stock`, `description?`, `categoryId?`, `isActive`. |
| PUT | /api/products/:id | Sí | ADMIN | Actualiza (parcial) un producto. |
| DELETE | /api/products/:id | Sí | ADMIN | Elimina un producto del negocio. |

## Clientes — `/api/clients`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/clients | Sí | — | Lista clientes (rol CLIENT) del negocio con búsqueda y paginación. Query: `search?`, `page`, `pageSize` o `limit`/`offset`. |
| GET | /api/clients/export/csv | Sí | — | Exporta los clientes del negocio a CSV. |
| GET | /api/clients/:id | Sí | — | Detalle de un cliente con sus últimas reservas, órdenes y notificaciones. |
| POST | /api/clients | Sí | — | Crea un cliente (con contraseña temporal). Body: `name`, `email`, `phone?`. |
| PATCH | /api/clients/:id | Sí | — | Actualiza datos de un cliente. Body: `name?`, `phone?`, `avatar?`. |
| DELETE | /api/clients/:id | Sí | — | Baja lógica (soft delete) de un cliente. |

## Órdenes / Pedidos — `/api/orders`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/orders | Sí | — | Lista pedidos del negocio con items y cliente (paginado). Query: `status?`, `page`/`pageSize` o `limit`/`offset`. |
| POST | /api/orders | Sí | — | Crea un pedido, su transacción de venta y descuenta stock. Soporta header `Idempotency-Key`. Body: `items[]` (`productId`, `quantity`), `paymentMethod`, `clientId?`, `notes?`. |
| PATCH | /api/orders/:id/status | Sí | — | Cambia el estado del pedido y notifica al cliente. Body: `status`. |

## Transacciones / Movimientos — `/api/transactions`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/transactions | Sí | — | Lista movimientos contables del negocio (paginado). Query: `from?`, `to?`, `type?`, `page`/`pageSize` o `limit`/`offset`. |
| POST | /api/transactions | Sí | ADMIN | Registra una transacción manual. Soporta header `Idempotency-Key`. Body: `amount`, `type`, `paymentMethod`, `reference?`, `notes?`. |
| GET | /api/transactions/export/csv | Sí | — | Exporta los movimientos del negocio a CSV. |

## Notificaciones — `/api/notifications`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/notifications | Sí | — | Lista notificaciones del usuario con conteo de no leídas. Query: `unreadOnly?`, `page`, `pageSize`. |
| GET | /api/notifications/unread-count | Sí | — | Devuelve la cantidad de notificaciones no leídas. |
| POST | /api/notifications | Sí | — | Crea una notificación. Body: `type`, `channel`, `title`, `body`, `userId`. |
| PUT | /api/notifications/read-all | Sí | — | Marca todas las notificaciones como leídas. |
| PATCH | /api/notifications/read-all | Sí | — | Alias de `PUT /read-all` (compatibilidad). |
| PUT | /api/notifications/:id/read | Sí | — | Marca una notificación como leída. |
| PATCH | /api/notifications/:id/read | Sí | — | Alias de `PUT /:id/read` (compatibilidad). |

## Categorías — `/api/categories`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/categories | Sí | — | Lista categorías del negocio con conteo de servicios y productos. |
| POST | /api/categories | Sí | ADMIN | Crea una categoría. Body: `name`, `icon?`, `sortOrder`. |
| PUT | /api/categories/:id | Sí | ADMIN | Actualiza (parcial) una categoría. |
| DELETE | /api/categories/:id | Sí | ADMIN | Elimina una categoría. |

## Profesionales — `/api/professionals`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/professionals | Sí | — | Lista los profesionales del negocio con su usuario y horarios. |
| GET | /api/professionals/:id | Sí | — | Detalle de un profesional con horarios, servicios y últimas reservas. |
| GET | /api/professionals/:id/availability | Sí | — | Calcula los slots libres del profesional en una fecha. Query: `date`. |
| POST | /api/professionals | Sí | — | Crea un profesional (crea/reutiliza el usuario). Body: `name`, `email`, `phone?`, `bio?`, `specialties?`, `serviceIds?`. |
| PUT | /api/professionals/:id | Sí | — | Actualiza un profesional. Body: `bio?`, `specialties?`, `isAvailable?`, `serviceIds?`. |
| DELETE | /api/professionals/:id | Sí | — | Elimina el profesional, o lo desactiva si ya tiene reservas. |

## Estadísticas — `/api/stats`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/stats/overview | Sí | — | Métricas generales del dashboard (turnos, ingresos, no-show), cacheadas 30s. |
| GET | /api/stats/weekly | Sí | — | Turnos e ingresos de los últimos 7 días. |
| GET | /api/stats/top-services | Sí | — | Top 5 de servicios más reservados del mes. |
| GET | /api/stats/dashboard | Sí | — | Panorama de conversaciones, bots, suscripción y actividad reciente. |
| GET | /api/stats/health | Sí | — | Indicadores de salud del negocio (confirmación, no-show, retención). |

## Horarios — `/api/schedules`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/schedules | Sí | — | Lista los bloques de horario del negocio. Query: `professionalId?`. |
| POST | /api/schedules | Sí | ADMIN | Crea un bloque de horario. Body: `dayOfWeek` (1-7), `startTime`, `endTime`, `professionalId`, `isActive`. |
| PUT | /api/schedules/:id | Sí | ADMIN | Actualiza (parcial) un bloque de horario. |
| DELETE | /api/schedules/:id | Sí | ADMIN | Elimina un bloque de horario. |

## IA — `/api/ai`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| POST | /api/ai/chat | Sí | — | Procesa un mensaje con el cerebro del bot y devuelve su respuesta. Body: `message`, `channel`, `history?`, `clientId?`, `conversationId?`, `botId?`, `contactName?`, `contactPhone?`. |
| POST | /api/ai/generate-prompt | Sí | — | Genera un prompt de sistema a partir de los datos del negocio. Body: `tone` (`formal`/`amigable`/`directo`). |
| GET | /api/ai/providers | Sí | — | Lista los proveedores de IA soportados y cuáles están configurados. |
| GET | /api/ai/engines | Sí | — | Catálogo de motores de IA con su estado para el negocio (nunca expone las keys). |
| PUT | /api/ai/engine | Sí | — | Cambia el motor de IA activo del negocio. Body: `engineId`. |
| PUT | /api/ai/keys | Sí | — | Guarda o borra la API key propia del negocio para un proveedor. Body: `provider`, `apiKey`. |

## Telegram — `/api/telegram`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| POST | /api/telegram/webhook/:businessId | No | — | Webhook público que recibe updates de Telegram (valida token por query). Query: `token`. |
| POST | /api/telegram/connect | Sí | — | Conecta un bot de Telegram y configura su webhook. Body: `botToken`. |
| DELETE | /api/telegram/disconnect | Sí | — | Desconecta el bot de Telegram del negocio. |
| GET | /api/telegram/status | Sí | — | Estado de la conexión de Telegram. |

## Configuración — `/api/settings`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/settings | Sí | — | Devuelve la configuración del negocio (nombre, slug, timezone, tema, etc.). |
| PUT | /api/settings | Sí | ADMIN | Actualiza la configuración del negocio. Body: `businessName?`, `slug?`, `phone?`, `email?`, `address?`, `timezone?`, `currency?`, `theme?`, `accentColor?`. |
| GET | /api/settings/ai-providers | Sí | — | Lista los proveedores de IA configurados como conexiones. |
| PUT | /api/settings/ai-providers/:providerKey | Sí | ADMIN | Crea o actualiza la conexión de un proveedor de IA. Body: `apiKey?`, `isActive?`. |
| DELETE | /api/settings/ai-providers/:providerKey | Sí | ADMIN | Elimina la conexión de un proveedor de IA. |

## Comandos — `/api/commands`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/commands | Sí | — | Lista los comandos del negocio agrupados por categoría (siembra defaults si no hay). |

## Prompts — `/api/prompts`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/prompts | Sí | — | Lista los prompts del negocio (siembra defaults si no hay). |
| POST | /api/prompts | Sí | ADMIN | Crea un prompt. Body: `name`, `category`, `content`, `isActive`. |
| PUT | /api/prompts/:id | Sí | ADMIN | Actualiza (parcial) un prompt. |
| DELETE | /api/prompts/:id | Sí | ADMIN | Elimina un prompt. |

## Habilidades — `/api/skills`

Generado por la fábrica `createCatalogFeaturesRouter('skill')`.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/skills | Sí | — | Lista las habilidades del negocio (siembra defaults si no hay). |
| PUT | /api/skills/:name | Sí | ADMIN | Actualiza una habilidad por nombre. Body: `subtitle?`, `description?`, `iconName?`, `isActive?`. |

## Superpoderes — `/api/superpowers`

Generado por la fábrica `createCatalogFeaturesRouter('superpower')`; incluye ganchos de superpoderes que producen contenido leyendo la DB.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/superpowers/report | Sí | — | Superpoder "Reportes automáticos": genera el reporte diario del negocio. |
| GET | /api/superpowers/reminders | Sí | — | Superpoder "Recordatorios inteligentes": genera los recordatorios del negocio. |
| GET | /api/superpowers/analisis/:conversationId | Sí | — | Superpoder "Analista IA": analiza una conversación (intención, satisfacción, objeciones, etc.). |
| GET | /api/superpowers/gaps | Sí | — | Superpoder "Auto-mejora": detecta huecos de conocimiento y sugiere qué agregar. |
| GET | /api/superpowers | Sí | — | Lista los superpoderes del negocio (siembra defaults si no hay). |
| PUT | /api/superpowers/:name | Sí | ADMIN | Actualiza un superpoder por nombre. Body: `subtitle?`, `description?`, `iconName?`, `isActive?`. |

## Plantillas de negocio — `/api/plantillas-negocio`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/plantillas-negocio | Sí | — | Lista las plantillas por giro/industria disponibles. |
| POST | /api/plantillas-negocio/:id/aplicar | Sí | ADMIN | Aplica una plantilla al negocio (crea servicios, prompt y activa superpoderes). |

## Bots — `/api/bots`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/bots | Sí | — | Lista los bots del negocio (paginado). Query: `page`, `pageSize`. |
| GET | /api/bots/:id | Sí | — | Detalle de un bot con sus últimas conversaciones. |
| POST | /api/bots | Sí | ADMIN | Crea un bot. Body: `name`, `description?`, `channel`, `config?`. |
| PATCH | /api/bots/:id | Sí | ADMIN | Actualiza un bot. Body: `name?`, `description?`, `channel?`, `status?`, `config?`, `token?`, `webhookUrl?`. |
| DELETE | /api/bots/:id | Sí | ADMIN | Elimina un bot. |
| GET | /api/bots/:id/conversations | Sí | — | Lista las conversaciones de un bot (paginado). Query: `page`, `pageSize`. |

## Equipo — `/api/team`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/team/members | Sí | — | Lista los miembros del equipo del negocio. |
| POST | /api/team/invite | Sí | ADMIN | Invita/crea un miembro del equipo. Body: `name?`, `email`, `role`. |
| PATCH | /api/team/members/:id | Sí | ADMIN | Actualiza el rol o estado de un miembro. Body: `role?`, `status?`. |
| DELETE | /api/team/members/:id | Sí | ADMIN | Elimina un miembro del equipo. |

## Marketplace — `/api/marketplace`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/marketplace/items | Sí | — | Lista los ítems del marketplace, marcando los instalados (siembra defaults). Query: `category?`, `search?`. |
| POST | /api/marketplace/items/:id/install | Sí | — | Instala un ítem del marketplace en el negocio. |
| DELETE | /api/marketplace/items/:id/install | Sí | — | Desinstala un ítem del marketplace del negocio. |

## Agencia — `/api/agency`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/agency/stats | Sí | — | Métricas de la agencia (clientes, bots, facturación, código de referido). |
| GET | /api/agency/clients | Sí | — | Lista los clientes de la agencia (paginado). Query: `search?`, `page`, `pageSize`. |
| POST | /api/agency/clients | Sí | ADMIN | Crea un cliente de agencia. Body: `name`, `plan?`, `status?`. |
| PATCH | /api/agency/clients/:id | Sí | ADMIN | Actualiza un cliente de agencia. Body: `name?`, `plan?`, `status?`, `bots?`, `revenue?`. |
| DELETE | /api/agency/clients/:id | Sí | ADMIN | Elimina un cliente de agencia. |

## Analítica — `/api/analytics`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/analytics/kpi | Sí | — | KPIs de los últimos 30 días con variación vs. período anterior. |
| GET | /api/analytics/conversations | Sí | — | Conversaciones por día de la última semana. |
| GET | /api/analytics/satisfaction | Sí | — | Distribución estimada de satisfacción (estrellas). |
| GET | /api/analytics/improvements | Sí | — | Sugerencias de mejora detectadas automáticamente. |
| GET | /api/analytics/costs | Sí | — | Costo estimado de IA por modelo (últimos 30 días). |
| GET | /api/analytics/metrics | Sí | — | Métricas de desempeño del bot (tiempo de respuesta, resolución, etc.). |

## Campañas — `/api/campaigns`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/campaigns | Sí | — | Lista las campañas del negocio (paginado). Query: `page`, `pageSize`. |
| GET | /api/campaigns/recipients | Sí | — | Lista los destinatarios elegibles según el canal. Query: `channel?`. |
| POST | /api/campaigns | Sí | ADMIN | Crea una campaña. Body: `name`, `description?`, `channel`, `scheduledAt?`. |
| PATCH | /api/campaigns/:id | Sí | ADMIN | Actualiza una campaña. Body: `name?`, `description?`, `status?`, `channel?`, `scheduledAt?`. |
| POST | /api/campaigns/:id/send | Sí | ADMIN | Envía (marca como enviada) una campaña. Body: `message?`. |
| DELETE | /api/campaigns/:id | Sí | ADMIN | Elimina una campaña. |

## White-label — `/api/whitelabel`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/whitelabel | Sí | — | Devuelve la configuración de marca del negocio (logo, colores, redes). |
| PATCH | /api/whitelabel | Sí | ADMIN | Actualiza la marca. Body: `name?`, `description?`, `logo?`, `primaryColor?`, `secondaryColor?`, `accentColor?`, `customDomain?`, `phone?`, `whatsappNumber?`, `instagramUrl?`, `facebookUrl?`, `websiteUrl?`. |
| GET | /api/whitelabel/preview | Sí | — | Vista previa de la marca con servicios activos y URL pública. |

## Arena — `/api/arena`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/arena/builders | Sí | — | Lista los "builders" (constructores de bots) del negocio. |
| POST | /api/arena/builders | Sí | ADMIN | Crea un builder. Body: `name`, `description?`, `systemPrompt?`, `model?`, `temperature?`. |
| PATCH | /api/arena/builders/:id | Sí | ADMIN | Actualiza un builder. Body: `name?`, `description?`, `systemPrompt?`, `model?`, `temperature?`, `status?`. |
| DELETE | /api/arena/builders/:id | Sí | ADMIN | Elimina un builder. |
| GET | /api/arena/ideas | Sí | — | Lista las ideas del negocio ordenadas por votos. |
| POST | /api/arena/ideas | Sí | — | Crea una idea. Body: `title`, `description?`, `category?`. |
| POST | /api/arena/ideas/:id/vote | Sí | — | Suma un voto a una idea. |
| POST | /api/arena/chat | Sí | — | Chat de prueba del bot Arena (respuesta mock). Body: `message`, `builderId?`. |

## Conversaciones — `/api/conversations`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/conversations | Sí | — | Lista conversaciones del negocio con último mensaje y canal efectivo. Query: `page`, `pageSize`, `status?`, `channel?`. |
| GET | /api/conversations/:id | Sí | — | Detalle de una conversación con todos sus mensajes. |
| POST | /api/conversations/:id/reply | Sí | — | Responde manualmente en una conversación (reabre si estaba en handoff). Body: `text`. |
| PATCH | /api/conversations/:id/close | Sí | — | Cierra una conversación abierta. |
| PATCH | /api/conversations/:id/assign | Sí | — | Asigna o desasigna la conversación a un miembro del equipo. Body: `assignedTo?` (null = desasignar). |
| PATCH | /api/conversations/:id/tags | Sí | — | Reemplaza las etiquetas de la conversación. Body: `tags[]`. |
| POST | /api/conversations/:id/notes | Sí | — | Agrega una nota interna del equipo. Body: `text`. |
| PATCH | /api/conversations/:id/read | Sí | — | Marca la conversación como leída por el usuario. |

## WhatsApp — `/api/whatsapp`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/whatsapp/status | Sí | — | Indica si el canal de WhatsApp (Twilio) está configurado. |
| POST | /api/whatsapp/webhook | No | — | Webhook entrante de Twilio (valida firma `X-Twilio-Signature`; body url-encoded). |
| POST | /api/whatsapp/send | Sí | — | Envía un mensaje de WhatsApp desde el número del negocio. Body: `to`, `message`. |

## Meta (Instagram / Messenger) — `/api/meta`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/meta/webhook | No | — | Verificación del webhook de Meta (devuelve `hub.challenge`). Query: `hub.mode`, `hub.verify_token`, `hub.challenge`. |
| POST | /api/meta/webhook | No | — | Eventos entrantes de mensajería de Meta (valida firma `X-Hub-Signature-256`). |
| POST | /api/meta/connect | Sí | — | Conecta una página de Facebook o cuenta de Instagram. Body: `platform`, `pageAccessToken`, `pageId?`, `igId?`, `pageName?`. |
| DELETE | /api/meta/disconnect | Sí | — | Desconecta una plataforma. Query: `platform` (`instagram`/`messenger`). |
| GET | /api/meta/status | Sí | — | Estado de las conexiones de Instagram y Messenger. |

## Facturación — `/api/billing`

Salvo el webhook, todas las rutas requieren autenticación **y** rol ADMIN (`router.use(requireAuth, requireRole('ADMIN'))`).

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| POST | /api/billing/webhook | No | — | Webhook de Stripe (valida firma sobre el cuerpo crudo). |
| GET | /api/billing/plans | Sí | ADMIN | Lista los planes activos. |
| GET | /api/billing/subscription | Sí | ADMIN | Devuelve la suscripción actual del negocio. |
| POST | /api/billing/subscribe | Sí | ADMIN | Crea una sesión de checkout de Stripe. Body: `planId`, `interval` (`monthly`/`yearly`). |
| POST | /api/billing/payment-link | Sí | ADMIN | Genera un link de pago de una sola vez. Body: `amount`, `description`, `currency?`. |
| POST | /api/billing/portal | Sí | ADMIN | Crea una sesión del portal de facturación de Stripe. |
| POST | /api/billing/cancel | Sí | ADMIN | Cancela la suscripción del negocio. |
| GET | /api/billing/invoices | Sí | ADMIN | Lista las últimas facturas del negocio. |

## Planes (público) — `/api/plans`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/plans/public | No | — | Lista pública de planes activos (para la landing/pricing). |

## Plantillas de mensaje — `/api/templates`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/templates | Sí | — | Lista las plantillas del negocio. Query: `type?`. |
| POST | /api/templates | Sí | — | Crea una plantilla. Body: `name`, `description?`, `content`, `category?`, `type` (`whatsapp`/`business`). |
| PATCH | /api/templates/:id | Sí | — | Actualiza (parcial) una plantilla. |
| DELETE | /api/templates/:id | Sí | — | Elimina una plantilla. |

## Webhooks (salientes) — `/api/webhooks`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/webhooks | Sí | — | Lista los webhooks configurados por el negocio. |
| GET | /api/webhooks/events | Sí | — | Lista los tipos de evento disponibles para suscribir. |
| POST | /api/webhooks | Sí | — | Crea un webhook (valida URL anti-SSRF). Body: `name`, `url`, `events[]`, `secret?`. |
| PATCH | /api/webhooks/:id | Sí | — | Actualiza un webhook (valida URL anti-SSRF). Body: `name?`, `url?`, `events?`, `secret?`, `isActive?`. |
| DELETE | /api/webhooks/:id | Sí | — | Elimina un webhook. |
| POST | /api/webhooks/:id/test | Sí | — | Envía una petición de prueba al webhook (valida URL anti-SSRF). |

## Punto de venta (POS) — `/api/pos`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/pos/items | Sí | — | Lista servicios activos y productos con stock como ítems vendibles del POS. |

## Voz (Twilio Voice) — `/api/voice`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/voice/status | Sí | — | Diagnóstico de la configuración de voz de Twilio del negocio. |
| GET | /api/voice/config | Sí | — | Devuelve la configuración de voz del negocio (idioma, voz, saludos). |
| PUT | /api/voice/config | Sí | ADMIN | Actualiza la configuración de voz. Body: `enabled?`, `assistantName?`, `language?`, `voice?`, `rate?`, `greeting?`, `closing?`, `reprompt?`, `persona?`. |
| POST | /api/voice/incoming | No | — | Webhook de Twilio al entrar una llamada; responde TwiML con el saludo (valida firma; body url-encoded). |
| POST | /api/voice/respond | No | — | Webhook de Twilio con la transcripción del cliente; procesa con IA y responde por voz (valida firma). |

## Voz de marca — `/api/brand`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/brand | Sí | — | Devuelve la Voz de Marca del negocio. |
| PUT | /api/brand | Sí | ADMIN | Actualiza (merge parcial) la Voz de Marca. Body: `tono?`, `publicoObjetivo?`, `infoNegocio?`, `reglas?`, `emojis?`. |

## Galería — `/api/galeria`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/galeria | Sí | — | Lista los ítems de la galería del negocio. |
| POST | /api/galeria | Sí | ADMIN | Agrega un ítem a la galería. Body: `url`, `tipo` (`image`/`video`/`audio`), `titulo?`, `descripcion?`. |
| DELETE | /api/galeria/:itemId | Sí | ADMIN | Elimina un ítem de la galería. |

## Integraciones (conectores por negocio)

Conectores de servicios externos que cada negocio configura desde el panel de **Conexiones**. Comparten el mismo patrón: la credencial se valida contra el proveedor al conectar y se guarda **cifrada** (AES-256-GCM) por negocio en la tabla `Connection` (una fila por `(businessId, type)`); los endpoints de `status` nunca exponen la credencial. Conectar y desconectar requieren rol **ADMIN**; consultar estado y operar (generar links, etc.) basta con estar autenticado.

> Las credenciales de integraciones **no** se cargan por `.env`: son por negocio y se administran desde el panel. Ver `DEPLOY.md`.

### Cal.com (agenda externa) — `/api/calcom`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/calcom/status | Sí | — | Estado de la conexión (sin exponer la API key). Devuelve `{ connected, enabled, eventTypeId }`. |
| GET | /api/calcom/event-types | Sí | — | Lista los tipos de evento de la cuenta conectada (requiere estar conectado). |
| POST | /api/calcom/connect | Sí | ADMIN | Valida la API key contra Cal.com y la guarda (cifrada). Body: `apiKey`, `eventTypeId?` (entero). |
| POST | /api/calcom/disconnect | Sí | ADMIN | Borra la conexión. Devuelve `{ connected: false, enabled: false, eventTypeId: null }`. |

### MercadoPago (pagos) — `/api/mercadopago`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/mercadopago/status | Sí | — | Estado de la conexión (sin exponer el access token). Devuelve `{ connected, enabled, currency }`. |
| POST | /api/mercadopago/connect | Sí | ADMIN | Valida el access token contra MercadoPago y lo guarda (cifrado). Body: `accessToken`, `currency?` (código ISO de 3 letras). |
| POST | /api/mercadopago/disconnect | Sí | ADMIN | Borra la conexión. Devuelve `{ connected: false, enabled: false, currency: "ARS" }`. |
| POST | /api/mercadopago/payment-link | Sí | — | Genera un link de cobro (preferencia de Checkout Pro). Requiere estar conectado. Body: `amount` (> 0), `description`, `currency?`. Devuelve `{ url, id }`. |

### ManyChat (canal bidireccional) — `/api/manychat`

ManyChat se usa como canal: los mensajes de los suscriptores entran al mismo cerebro del chatbot que el resto de los canales y la respuesta vuelve en formato **Dynamic Block v2**. La integración tiene dos partes: los endpoints de administración (autenticados, para conectar/configurar) y el **webhook entrante público** (autenticado por token compartido) que ManyChat llama en cada mensaje.

#### Endpoints de administración

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/manychat/status | Sí | — | Estado de la conexión. Devuelve `{ connected, enabled }`; el campo `webhookToken` (secreto para pegar en ManyChat) se incluye **solo para rol ADMIN**. |
| POST | /api/manychat/connect | Sí | ADMIN | Valida la API key contra ManyChat y la guarda (cifrada); genera el token del webhook entrante en la primera conexión. Body: `apiKey`. |
| POST | /api/manychat/disconnect | Sí | ADMIN | Borra la conexión. Devuelve `{ connected: false, enabled: false }`. |
| POST | /api/manychat/regenerate-token | Sí | ADMIN | Rota el token del webhook (invalida el anterior). Responde `400` si ManyChat no está conectado. |

#### Webhook entrante — `POST /api/manychat/webhook/:businessId`

Endpoint **público** (sin `requireAuth`): ManyChat lo llama cuando un suscriptor escribe. Se autentica con el token compartido del negocio.

- **Método y ruta:** `POST /api/manychat/webhook/:businessId`, donde `:businessId` es el ID del negocio. Queda **fuera del rate limit global por IP** (ManyChat llama desde IPs compartidas) y tiene su propio límite por negocio/suscriptor.
- **Autenticación (por header):** header `x-webhook-token: <token>`, comparado de forma *timing-safe*. El token se obtiene en el panel de Conexiones → ManyChat (campo visible solo para ADMIN) o vía `POST /api/manychat/regenerate-token`. Se usa header (no query) para que el secreto no termine en los access logs. Si el token falta o es inválido, responde `401`. El webhook solo acepta mensajes si la conexión está activa (API key + `enabled`) y existe token.
- **Body aceptado (tolerante):** ManyChat arma el cuerpo de la "External Request", así que se aceptan los nombres de campo más comunes y se toleran valores `null`/numéricos; las claves desconocidas se descartan. Campos:
  - **Mensaje** (lo primero no vacío de): `text` | `message` | `last_input_text` (máx. 4000 caracteres).
  - **Suscriptor** (lo primero no nulo de): `subscriberId` | `subscriber_id` | `user_id` (string o número).
  - **Nombre** (opcional): `name` | `first_name`.
  - **Continuidad** (opcional): `conversationId` — para mantener el hilo entre mensajes.
- **Formato de respuesta (Dynamic Block v2):** siempre `200` con JSON que ManyChat renderiza al suscriptor:

  ```json
  {
    "version": "v2",
    "content": { "messages": [{ "type": "text", "text": "..." }] },
    "conversationId": "..."
  }
  ```

  El campo `conversationId` se incluye solo si hay hilo; ManyChat lo ignora al renderizar, pero una configuración con "External Request" puede mapearlo a un campo del suscriptor para darle continuidad en el próximo mensaje.
- **Rate limits propios:** 120 mensajes/min por negocio y 15 mensajes/min por suscriptor (ventana de 1 minuto). Al exceder, responde un Dynamic Block de cortesía (no `429`).
- **Nunca devuelve 400/429/500 a ManyChat** (lo reintentaría): ante body inesperado, falta de texto (p. ej. imagen/sticker), exceso de rate limit o error interno, responde siempre un Dynamic Block de cortesía con `200`. La única excepción es el `401` por token inválido.

#### Cómo configurarlo en ManyChat (acción "External Request")

1. Conectá ManyChat desde el panel (Conexiones → ManyChat) y copiá el **webhook token** (visible para ADMIN en `GET /api/manychat/status`).
2. En el flujo de ManyChat, agregá una acción **External Request** con:
   - **Method:** `POST`
   - **URL:** `https://<URL-pública-del-server>/api/manychat/webhook/<businessId>`
   - **Header:** `x-webhook-token: <token copiado>`
   - **Body (JSON):** incluí al menos el texto del suscriptor y su ID, por ejemplo:

     ```json
     { "text": "{{last input}}", "subscriberId": "{{user id}}", "name": "{{first name}}" }
     ```

3. Mapeá la respuesta: mostrá `content.messages[0].text` al suscriptor y, si querés continuidad, guardá `conversationId` en un campo personalizado y reenvialo como `conversationId` en la próxima External Request.

> El server debe ser **accesible públicamente** para que ManyChat pueda llamar al webhook. Ver `DEPLOY.md`.

### Composio (herramientas/apps para el bot) — `/api/composio`

Conecta Composio (https://composio.dev), plataforma que expone cientos de apps/herramientas vía una API unificada. La API key se valida contra `backend.composio.dev` (header `x-api-key`) y se guarda cifrada por negocio.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/composio/status | Sí | — | Estado de la conexión (sin exponer la API key). Devuelve `{ connected, enabled }`. |
| POST | /api/composio/connect | Sí | ADMIN | Valida la API key contra Composio y la guarda (cifrada). Body: `apiKey`. |
| POST | /api/composio/disconnect | Sí | ADMIN | Borra la conexión. Devuelve `{ connected: false, enabled: false }`. |

## Chat y reservas públicas — `/api/public`

Router montado con CORS abierto (`origin: true`, sin credenciales). Ningún endpoint requiere autenticación: son de cara al widget público / cliente final.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/public/bot/demo | No | — | Devuelve un bot activo cualquiera para la demo pública. |
| GET | /api/public/bot/:botId | No | — | Datos públicos de un bot (404 si está en DRAFT). |
| POST | /api/public/chat | No | — | Chat público con un bot (con guarda de costo de visión por día). Body: `message`, `botId`, `conversationId?`, `contactName?`, `contactPhone?`, `imageUrl?`, `imageUrls?`. |
| GET | /api/public/book/:slug | No | — | Datos públicos de reserva de un negocio (servicios, horarios, profesionales). |
| GET | /api/public/book/:slug/slots | No | — | Slots disponibles para reservar. Query: `date`, `serviceId`, `professionalId?`. |
| POST | /api/public/book/:slug/request-otp | No | — | Envía un código OTP por WhatsApp para verificar el teléfono. Body: `phone`. |
| POST | /api/public/book/:slug | No | — | Crea una reserva pública (con verificación OTP opcional y reserva atómica). Body: `serviceId`, `professionalId?`, `date`, `time`, `name`, `phone`, `email?`, `otp?`. |
