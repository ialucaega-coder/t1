# Referencia de la API

Documentación de referencia de la API HTTP del backend (Express + TypeScript, `apps/server`).
Se generó a partir del código fuente (`apps/server/src/index.ts` y `apps/server/src/routes/*.ts`); solo se documentan endpoints que existen realmente en el código.

**Última verificación contra el código:** 2026-11-16 (working tree actual de `apps/server`).
Las secciones marcadas con `(no verificado)` tienen método, ruta, autenticación y rol comprobados contra el código, pero no se revisaron línea por línea sus cuerpos, respuestas o descripciones.

## Introducción

- **URL base:** todos los endpoints cuelgan del prefijo `/api`. En desarrollo el servidor escucha en `http://localhost:4000` (configurable con la variable de entorno `PORT`), por lo que la URL base típica es `http://localhost:4000/api`. Las URLs completas de cada tabla incluyen el prefijo `/api`.
- **Autenticación (`Authorization: Bearer <token>`):** los endpoints protegidos usan un JWT que se obtiene de `POST /api/auth/login`, `POST /api/auth/register` o `POST /api/auth/accept-invite` (campo `token` de la respuesta). Ese token se envía en cada petición con el header `Authorization: Bearer <token>`. El middleware `requireAuth` valida el JWT y que la sesión no haya sido revocada; si falta, es inválido o está revocado, responde `401`. Además, al iniciar sesión se emite una cookie httpOnly `session_token` (`SameSite=strict`, 14 días) como defensa en profundidad.
- **Segundo factor (2FA):** si la cuenta tiene 2FA activo, `POST /api/auth/login` sin `twoFactorCode` responde `200` con `{ "twoFactorRequired": true }` y sin token. Con un código incorrecto responde `401`.
- **Bloqueo de cuenta:** 5 intentos fallidos (contraseña o código 2FA) bloquean el login durante 15 minutos (`423`).
- **Autorización por rol:** los roles de usuario son `ADMIN`, `PROFESSIONAL` y `CLIENT`. El middleware `requireRole` responde `403` si el rol del token no alcanza. El middleware `requireStaff` exige ADMIN o PROFESSIONAL: un `CLIENT` recibe `403`. En las tablas, la columna **Rol** indica el requisito mínimo: `—` cuando cualquier usuario autenticado sirve, `Staff` para ADMIN o PROFESSIONAL, `ADMIN` o `ADMIN, PROFESSIONAL` cuando se listan los roles, y `Super Admin` para los endpoints de plataforma (allowlist por email en la variable `PLATFORM_ADMIN_EMAILS`).
- **Capacidades por plan y rol:** el middleware `requireCapability` (aplicado en el montaje de cada router, ver la tabla de abajo, y en algunos endpoints inline) responde `403` con `{ error, capability, planTier }` si la capacidad no está disponible por el plan, el rol o el override del miembro. El ADMIN nunca se capa.
- **Errores de validación:** body o query inválidos responden `400` (validación con zod).
- **Rate limits:** límite global de la API de 300 requests por 15 minutos por IP. Auth (`/api/auth/login`, `/register`, `/accept-invite` y `PATCH /me`) tiene un límite estricto de 10 requests por 15 minutos por IP. Varios endpoints tienen además un tope por negocio (`tenantRateLimit`), indicado en cada fila de la tabla. Los webhooks de terceros y el polling del chat público quedan fuera del límite global (tienen sus propios topes). Con `REDIS_URL` el conteo se comparte entre instancias; sin Redis es en memoria. En `NODE_ENV=development` el límite global no se aplica. Al exceder un límite responde `429`.
- **Header `Idempotency-Key`:** los endpoints `POST /api/transactions`, `POST /api/orders` y `POST /api/conversations/:id/reply` aceptan un header opcional `Idempotency-Key`. Si se reintenta la misma petición con la misma clave (por doble click o reintento de red), el servidor no duplica el registro. En `transactions` y `orders` devuelve el recurso ya creado con estado `200` en lugar de `201`; en `reply` responde `200` con `{ "duplicate": true }`. En transacciones y pedidos la deduplicación está serializada con un advisory lock por (negocio, clave). Las acciones en vivo de MrGo (`/api/mrgo/orchestrate`, `/run` y `/confirm`) también aceptan la clave: un reintento responde `409` con `code: "DUPLICATE_REQUEST"`.
- **Multi-tenant por `businessId`:** cada usuario pertenece a un negocio (`businessId`, embebido en el JWT). Todas las consultas de datos están acotadas ("scoped") al `businessId` del token, de modo que un negocio nunca ve ni modifica datos de otro. El `businessId` no se envía en el body: se toma siempre del token.
- **Formato:** las peticiones y respuestas usan JSON (`Content-Type: application/json`), salvo los webhooks de Twilio (voz y WhatsApp), que llegan como `application/x-www-form-urlencoded`. El webhook de Stripe requiere el cuerpo crudo (`express.raw`) para validar la firma; el de Meta valida la firma sobre el buffer crudo que guarda el parser JSON (`rawBody`). Las respuestas de exportación `export/csv` devuelven `text/csv`.
- **Límite de cuerpo:** las rutas públicas (`/api/public`, `/api/auth` y `/api/mercadopago/webhook`) aceptan hasta 100 KB. El resto de la API acepta hasta 5 MB.
- **Health check:** `GET /api/health` — endpoint público (sin auth) que responde `{ status: "ok", timestamp }`.

---

## Montajes y middlewares por router (`index.ts`)

Esta tabla resume qué middlewares aplica `index.ts` al montar cada router. Cuando un router exige un rol o una capacidad por ruta, aparece en su sección.

| Montaje | Middlewares de montaje | Notas |
|---------|------------------------|-------|
| `/api/health` | ninguno | Público. |
| `/api/auth` | ninguno (cada ruta aplica lo suyo) | Cuerpo público de 100 KB. |
| `/api/bookings` | ninguno (`requireAuth` por ruta) | `GET /` y `GET /export/csv` exigen staff; `PATCH /:id` y `PATCH /:id/status` exigen ADMIN o PROFESSIONAL; `DELETE` exige ADMIN. |
| `/api/services` | ninguno | Escrituras exigen ADMIN. `DELETE` es baja lógica. |
| `/api/products` | ninguno | Escrituras exigen ADMIN. `DELETE` es baja lógica. |
| `/api/clients` | `requireAuth`, `requireStaff`, `requireCapability('clients')` | |
| `/api/orders` | ninguno (`requireAuth` por ruta) | `GET /` y los `PATCH` exigen staff. |
| `/api/transactions` | `requireAuth`, `requireStaff`, `requireCapability('sales')` | `POST` exige ADMIN. |
| `/api/notifications` | ninguno | |
| `/api/categories` | ninguno | Escrituras exigen ADMIN. |
| `/api/professionals` | ninguno | |
| `/api/stats` | `requireAuth`, `requireStaff`, `requireCapability('analytics')` | Un `CLIENT` recibe `403`. |
| `/api/schedules` | ninguno | Escrituras exigen ADMIN. |
| `/api/ai` | `requireAuth`, `requireStaff` | `GET /spend-overview` exige Super Admin. |
| `/api/faq` | `requireAuth`, `requireCapability('bots')` | |
| `/api/onboarding` | `requireAuth` | |
| `/api/telegram` | ninguno | El webhook es público. |
| `/api/settings` | ninguno | `PUT /` exige ADMIN. |
| `/api/commands` | ninguno | |
| `/api/prompts` | ninguno | Escrituras exigen ADMIN. |
| `/api/skills` | ninguno | Fábrica `createCatalogFeaturesRouter('skill')`. |
| `/api/superpowers` | ninguno | Fábrica `createCatalogFeaturesRouter('superpower')`. |
| `/api/plantillas-negocio` | ninguno | |
| `/api/bots` | `requireAuth`, `requireCapability('bots')` | Escrituras exigen ADMIN. |
| `/api/team` | ninguno (`requireAuth` por ruta) | `GET /members` exige staff. |
| `/api/integrations` | ninguno (`requireAuth` por ruta) | |
| `/api/marketplace` | `requireAuth`, `requireCapability('tools')` | |
| `/api/agency` | ninguno | Capacidad `agency` aplicada por ruta. |
| `/api/analytics` | `requireAuth`, `requireStaff`, `requireCapability('analytics')` | Un `CLIENT` recibe `403`. |
| `/api/campaigns` | `requireAuth`, `requireCapability('marketing')` | Escrituras exigen ADMIN. |
| `/api/wa-templates` | `requireAuth`, `requireCapability('marketing')` | `approve` y `reject` exigen ADMIN. |
| `/api/whitelabel` | ninguno | `PATCH /` exige ADMIN. |
| `/api/arena` | `requireAuth`, `requireCapability('tools')` | |
| `/api/conversations` | `requireAuth`, `requireStaff`, `requireCapability('conversations')` | |
| `/api/whatsapp` | ninguno (`requireAuth` / `requireStaff` por ruta) | |
| `/api/meta` | ninguno | |
| `/api/billing` | ninguno; el router aplica `requireAuth` + `requireRole('ADMIN')` a todo salvo el webhook | Webhook de Stripe público. |
| `/api/plans` | ninguno | |
| `/api/templates` | ninguno | |
| `/api/webhooks` | ninguno | |
| `/api/pos` | ninguno | |
| `/api/voice` | ninguno (`requireAuth` por ruta) | Webhooks públicos de Twilio. |
| `/api/brand` | ninguno | `PUT /` exige ADMIN. |
| `/api/galeria` | ninguno | Escrituras exigen ADMIN. |
| `/api/calcom` | ninguno | Conectar y desconectar exigen ADMIN. |
| `/api/mercadopago/webhook` | ninguno; se monta ANTES del límite global por IP | Webhook público con su propio tope. |
| `/api/mercadopago` | ninguno (`requireAuth` y roles por ruta) | |
| `/api/manychat` | ninguno (`requireAuth` por ruta) | El webhook es público. |
| `/api/composio` | ninguno | Conectar y desconectar exigen ADMIN. |
| `/api/workflows` | `requireAuth`, `requireStaff` | Escrituras exigen ADMIN. Un `CLIENT` recibe `403`. |
| `/api/mrgo` | ninguno (`requireAuth` por ruta) | |
| `/api/mcp` | ninguno (`requireAuth` por ruta) | |
| `/api/platform` | `requireAuth`, `requirePlatformAdmin` | Super Admin, cross-tenant. |
| `/api/public` | CORS abierto (sin credenciales), cuerpo de 100 KB | Sin autenticación. |

---

## Auth — `/api/auth`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| POST | /api/auth/register | No | — | Registra un negocio nuevo y su usuario ADMIN, devuelve el token (`201`) y setea la cookie. Body: `email`, `password` (mínimo 8 caracteres con mayúscula, minúscula y número), `name` (mínimo 2), `businessName` (2 a 80 caracteres). Limitado por auth. |
| POST | /api/auth/login | No | — | Inicia sesión y devuelve el JWT. Body: `email`, `password`, `twoFactorCode?`. Sin código y con 2FA activo responde `{ twoFactorRequired: true }`. Código inválido: `401`. Cuenta bloqueada: `423`. Limitado por auth. |
| POST | /api/auth/accept-invite | No | — | Canjea una invitación al equipo por mail (link de un solo uso, vence a los 7 días). Crea el usuario con el rol del miembro, activa al miembro, quema el token y devuelve sesión (`201`). Body: `token`, `name` (mínimo 2), `password` (misma política que el registro). Cualquier fallo del canje responde `400` con un mensaje genérico. Limitado por auth y por un tope propio de invitaciones. |
| GET | /api/auth/me | Bearer | — | Devuelve el usuario y el negocio del token. Valida el Bearer a mano. Responde `401` si la sesión está revocada o la cuenta fue dada de baja. |
| PATCH | /api/auth/me | Bearer | — | Actualiza el nombre y/o la contraseña del usuario autenticado. Body: `name?` (mínimo 2), `currentPassword?`, `newPassword?`. Cambiar la contraseña exige `currentPassword` y revoca las sesiones anteriores a la actual. Limitado por auth. |
| POST | /api/auth/logout | Bearer | — | Cierra sesión: borra la cookie `session_token`, revoca las sesiones del usuario en el servidor y responde `204`. |
| GET | /api/auth/2fa/status | Bearer | — | Estado de 2FA del usuario: `{ enabled, recoveryCodesRemaining }`. |
| POST | /api/auth/2fa/setup | Bearer | — | Inicia el alta de 2FA: genera un secreto TOTP (guardado cifrado) y devuelve `otpauthUri` y `qrDataUrl`. Queda inactivo hasta verificar el primer código. Responde `409` si ya está activo. |
| POST | /api/auth/2fa/verify | Bearer | — | Confirma el alta de 2FA con un código TOTP de 6 dígitos. Body: `code`. Activa 2FA y devuelve `recoveryCodes` (se muestran una sola vez). `400` si el código es inválido o no hay un alta iniciada. |
| POST | /api/auth/2fa/disable | Bearer | — | Desactiva 2FA. Body: `code` (TOTP de 6 dígitos o código de recuperación). Borra los códigos de recuperación. |
| POST | /api/auth/2fa/recovery-codes | Bearer | — | Emite un juego nuevo de códigos de recuperación, que invalida los anteriores. Body: `code` (TOTP o código de recuperación vigente). Devuelve `recoveryCodes`. |

## Reservas / Turnos — `/api/bookings`

Montaje sin middlewares; cada ruta aplica lo suyo. Todo se acota por `businessId`. El listado y la exportación traen nombre, email y teléfono de los clientes, así que son solo de staff: un `CLIENT` con JWT recibe `403`.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/bookings | Sí | Staff | Lista turnos del negocio ordenados por `startTime`. Query: `date?`, `status?`, `professionalId?`, `page`/`pageSize` o `limit`/`offset`. |
| POST | /api/bookings | Sí | — | Crea un turno con el servicio `createBooking` (chequeo de conflictos por profesional, `(no verificado)` el detalle del anti-solape). Body: `date`, `startTime` (HH:mm), `serviceId`, `professionalId`, `clientId?`, `notes?`, `source?` (`WEB`, `TELEGRAM`, `WHATSAPP`, `VOICE` o `WALK_IN`; por defecto `WEB`). Responde `201`. Dispara notificaciones, automatizaciones y, si está conectado, la sincronización con Cal.com. |
| GET | /api/bookings/export/csv | Sí | Staff | Exporta hasta 5000 reservas del negocio a CSV, de la más reciente a la más antigua. Las celdas se escapan para evitar inyección de fórmulas. |
| PATCH | /api/bookings/:id | Sí | ADMIN, PROFESSIONAL | Edita o reprograma un turno (fecha, hora, servicio, profesional, notas). Parcial. Valida pertenencia al negocio y conflictos de agenda con el mismo lock que el alta (`(no verificado)` el detalle). No notifica al cliente. |
| PATCH | /api/bookings/:id/status | Sí | ADMIN, PROFESSIONAL | Cambia el estado del turno. Body: `status` (`PENDING`, `CONFIRMED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED` o `NO_SHOW`). Los estados finales (`CANCELLED`, `COMPLETED`, `NO_SHOW`) no se reabren: responde `409` (el horario pudo haber sido tomado por otra reserva). `404` si el turno no es del negocio. Notifica al cliente cuando pasa a `CONFIRMED` o `CANCELLED`. |
| DELETE | /api/bookings/:id | Sí | ADMIN | Elimina un turno. Responde `204`. |

## Servicios — `/api/services`

> (no verificado) Cuerpos, respuestas y descripciones de esta sección. Método, ruta y rol sí verificados.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/services | Sí | — | Lista los servicios del negocio con categoría y profesionales. No incluye los dados de baja. |
| POST | /api/services | Sí | ADMIN | Crea un servicio. Body: `name`, `duration` (entero de 1 a 1440 minutos), `price` (mayor a 0 y hasta 99.999.999,99), `description?`, `categoryId?`, `isActive`. |
| PUT | /api/services/:id | Sí | ADMIN | Actualiza (parcial) un servicio, con los mismos topes. `404` si está dado de baja. |
| DELETE | /api/services/:id | Sí | ADMIN | Baja lógica: marca `deletedAt` y `isActive=false`. El historial de reservas queda intacto y el servicio deja de listarse, de ofrecerse en plantillas y de entrar en la disponibilidad. Responde `{ success: true }`; `404` si no existe o ya estaba dado de baja. |

## Productos — `/api/products`

> (no verificado) Cuerpos, respuestas y descripciones de esta sección. Método, ruta y rol sí verificados.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/products | Sí | — | Lista los productos del negocio (paginado opcional). No incluye los dados de baja. Query: `page`/`limit`/`offset`. |
| POST | /api/products | Sí | ADMIN | Crea un producto. Body: `name`, `price` (mayor a 0 y hasta 99.999.999,99), `stock` (entero de 0 a 1.000.000; por defecto 0), `description?`, `categoryId?`, `isActive`. |
| PUT | /api/products/:id | Sí | ADMIN | Actualiza (parcial) un producto, con los mismos topes. Acepta `expectedUpdatedAt` (ISO): si el producto cambió desde entonces (por ejemplo, una venta descontó stock), no se aplica y responde `409` con `code: PRODUCT_STALE`. `404` si está dado de baja. |
| DELETE | /api/products/:id | Sí | ADMIN | Baja lógica: marca `deletedAt` y `isActive=false`. El historial de ventas queda intacto y el producto deja de listarse y de venderse (POS, estadísticas, executor y Telegram lo ignoran). Responde `{ success: true }`; `404` si no existe o ya estaba dado de baja. |

## Clientes — `/api/clients`

Montaje con `requireAuth`, `requireStaff` y `requireCapability('clients')`. Un `CLIENT` recibe `403`.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/clients | Sí | Staff | Lista clientes (rol `CLIENT`, no borrados) con búsqueda y paginación. Query: `search?` (nombre, email o teléfono), `tagId?` (filtra por etiqueta del CRM), `page`/`pageSize` (máx. 100) o `limit`/`offset`. Cada cliente trae `tags` y `stage` (etapa del embudo). En la forma por página también devuelve `tagCatalog`. |
| GET | /api/clients/export/csv | Sí | Staff | Exporta los clientes a CSV en streaming, por lotes de 500. Escapa celdas para evitar inyección de fórmulas. |
| GET | /api/clients/crm | Sí | Staff | Catálogo de etiquetas del CRM del negocio y anotaciones (etiquetas y nota interna) por cliente. |
| GET | /api/clients/funnel | Sí | Staff | Cantidad de clientes por etapa del ciclo de vida: `NEW`, `HOT`, `PAYMENT`, `CUSTOMER`. |
| PUT | /api/clients/crm/tags | Sí | Staff | Reemplaza el catálogo de etiquetas del CRM. Body: `tags[]` (cada una con `label` obligatorio, `id?` y `color?`; máx. `MAX_TAGS`). |
| PUT | /api/clients/:id/tags | Sí | Staff | Setea las etiquetas de un cliente. Body: `tags[]` (strings). `404` si el cliente no es del negocio. |
| PUT | /api/clients/:id/note | Sí | Staff | Setea la nota interna de un cliente. Body: `note` (string con límite). `404` si el cliente no es del negocio. |
| PATCH | /api/clients/:id/lifecycle | Sí | Staff | Mueve al cliente de etapa en el embudo. Body: `stage` (`NEW`, `HOT`, `PAYMENT` o `CUSTOMER`). Devuelve `{ stage }`. |
| GET | /api/clients/:id | Sí | Staff | Detalle de un cliente con sus últimas 10 reservas, 5 pedidos y 5 notificaciones, más `tags`, `note` y `stage`. |
| POST | /api/clients | Sí | Staff | Crea un cliente con contraseña aleatoria (no usable). Body: `name` (mínimo 2), `email`, `phone?`. Responde `201`. `403` con `code: PLAN_LIMIT_REACHED` si se alcanzó el máximo de contactos del plan. `409` si el email ya existe en el negocio. Dispara la automatización `lead_nuevo`. |
| PATCH | /api/clients/:id | Sí | Staff | Actualiza datos de un cliente. Body: `name?` (mínimo 2), `phone?`, `avatar?` (URL). No exige un rol específico dentro del staff. |
| DELETE | /api/clients/:id | Sí | Staff | Baja lógica (soft delete) de un cliente. Responde `{ success: true }`. |

## Órdenes / Pedidos — `/api/orders`

Montaje sin middlewares. `GET /` y los `PATCH` exigen staff; `POST /` lo acepta cualquier usuario autenticado.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/orders | Sí | Staff | Lista pedidos con items y cliente (paginado). El cliente viaja solo como `{ id, name, phone }`. Query: `status?` (`PENDING`, `CONFIRMED`, `PREPARING`, `READY`, `DELIVERED`, `CANCELLED`), `search?` (nombre, email o teléfono del cliente, o el código `ORD-XXXXXXXX` / su sufijo), `page`/`pageSize` o `limit`/`offset`. |
| POST | /api/orders | Sí | — | Alta manual de un pedido. Crea el pedido, su transacción de venta (`SALE`) y descuenta stock. Soporta `Idempotency-Key`: un reintento con el mismo contenido devuelve el pedido original; la misma clave con un contenido distinto (otros items o cantidades, otro cliente u otro método de pago) responde `409`; la nota y los precios no se comparan. El `client` de la respuesta es solo `{ id, name, phone, email }` (nunca el usuario completo). Body: `items[]` (`productId`, `quantity` entero de 1 a 10000; de 1 a 100 items), `paymentMethod` (`CASH`, `CARD`, `TRANSFER` o `QR`), `clientId?` (debe ser del negocio; por defecto el usuario que llama), `notes?` (máx. 2000). Los precios salen siempre de la base. Las líneas repetidas se suman. Si el total supera 99.999.999,99 responde `400`. Si el stock está entre 0 y la cantidad pedida, responde `409`. Responde `201` (`200` en un reintento idempotente). |
| PATCH | /api/orders/:id/status | Sí | Staff | Cambia el estado del pedido y notifica al cliente. Body: `status`. Transiciones: hacia adelante dentro del flujo `PENDING` → `CONFIRMED` → `PREPARING` → `READY` → `DELIVERED` (se puede saltar pasos); a `CANCELLED` desde cualquier estado no final; nunca hacia atrás. `DELIVERED` y `CANCELLED` son finales. Repetir el estado actual responde `200` sin cambios. Una transición inválida responde `409`. |
| PATCH | /api/orders/:id/notes | Sí | Staff | Actualiza la nota interna del pedido. Body: `notes` (máx. 2000). Vacía = borrar la nota. |

## Transacciones / Movimientos — `/api/transactions`

Montaje con `requireAuth`, `requireStaff` y `requireCapability('sales')`.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/transactions | Sí | Staff | Lista movimientos contables (paginado, más recientes primero). Query: `type?` (`SALE`, `REFUND`, `PARTIAL`), `paymentMethod?` (`CASH`, `CARD`, `TRANSFER`, `QR`), `from?` y `to?` (sobre `createdAt`: `YYYY-MM-DD` es el día calendario argentino, de 00:00 a 24:00 hora AR, y ambos extremos son inclusivos; también se acepta un instante ISO completo; una fecha que no existe o con otro formato responde `400`), `page`/`pageSize` o `limit`/`offset`. `type` y `paymentMethod` son campos distintos y se combinan con AND. |
| GET | /api/transactions/summary | Sí | Staff | Totales reales con los mismos filtros que el listado: `{ sales, partial, refunds, net, count, counts: { SALE, PARTIAL, REFUND } }`. `net` = ventas + parciales − reembolsos. |
| POST | /api/transactions | Sí | ADMIN | Registra una transacción manual. Soporta `Idempotency-Key` (reintento con el mismo contenido responde `200`; la misma clave con otro contenido —monto redondeado a centavos, tipo, método de pago, referencia o notas—, `409`). Body: `amount` (mayor a 0), `type?` (por defecto `SALE`), `paymentMethod`, `reference?`, `notes?`. Dispara la automatización `pago_recibido` solo para `SALE` y `PARTIAL`. |
| GET | /api/transactions/export/csv | Sí | Staff | Exporta hasta 5000 movimientos a CSV, con el número de pedido asociado si lo hay. |

## Notificaciones — `/api/notifications`

> (no verificado) Cuerpos, respuestas y descripciones de esta sección. Método, ruta y rol sí verificados.

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

Montaje sin middlewares. Escrituras exigen ADMIN.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/categories | Sí | — | Lista categorías del negocio con conteo de servicios y productos. |
| POST | /api/categories | Sí | ADMIN | Crea una categoría. `409` si ya existe otra con el mismo nombre (sin distinguir mayúsculas). Body: `name`, `icon?`, `sortOrder` (`(no verificado)` el schema). Responde `201`. |
| PUT | /api/categories/:id | Sí | ADMIN | Actualiza (parcial) una categoría. `409` si el nuevo nombre ya existe en el negocio. |
| DELETE | /api/categories/:id | Sí | ADMIN | Elimina una categoría. Si tiene productos o servicios, responde `409` con `code: CATEGORY_IN_USE` y los conteos, y no borra nada. Con `?detach=true` deja esos productos y servicios sin categoría y luego elimina la categoría (en una sola transacción). Responde `204`. |

## Profesionales — `/api/professionals`

> (no verificado) Cuerpos, respuestas y descripciones de esta sección. Método, ruta y rol sí verificados.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/professionals | Sí | — | Lista los profesionales del negocio con su usuario y horarios. |
| GET | /api/professionals/:id | Sí | — | Detalle de un profesional con horarios, servicios y últimas reservas. |
| GET | /api/professionals/:id/availability | Sí | — | Calcula los slots libres del profesional en una fecha. Query: `date`. |
| POST | /api/professionals | Sí | — | Crea un profesional (crea o reutiliza el usuario). Body: `name`, `email`, `phone?`, `bio?`, `specialties?`, `serviceIds?`. |
| PUT | /api/professionals/:id | Sí | — | Actualiza un profesional. Body: `bio?`, `specialties?`, `isAvailable?`, `serviceIds?`. |
| DELETE | /api/professionals/:id | Sí | — | Elimina el profesional, o lo desactiva si ya tiene reservas. |

## Estadísticas — `/api/stats`

Montaje con `requireAuth`, `requireStaff` y `requireCapability('analytics')`: un `CLIENT` con JWT recibe `403` (antes podía leer ingresos y reservas). Las respuestas se cachean 30 segundos por negocio y rango.

**Rango de fechas:** `overview`, `weekly` y `top-services` aceptan `?days=N` (1 a 366, días calendario que incluyen hoy) o `?from=YYYY-MM-DD&to=YYYY-MM-DD` (`to` es opcional y por defecto es hoy; las fechas futuras se recortan a hoy). `days` no se combina con `from`/`to`, y `to` exige `from`. Un rango inválido responde `400`. `dashboard` y `health` no aceptan rango.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/stats/overview | Sí | — | Métricas del dashboard (turnos de hoy, turnos del período, ingresos, tasa de no-show y variaciones). Sin rango compara este mes con el anterior; con rango compara la ventana pedida con la anterior de igual largo. Incluye `range`. |
| GET | /api/stats/weekly | Sí | — | Turnos e ingresos por día. Sin rango son los últimos 7 días; con rango, una entrada por día de la ventana. |
| GET | /api/stats/top-services | Sí | — | Top 5 de servicios más reservados. Sin rango es el mes en curso; con rango, la ventana pedida. |
| GET | /api/stats/dashboard | Sí | — | Panorama de conversaciones (abiertas, totales, en handoff, mensajes de hoy y del mes), bots activos, suscripción y actividad reciente. |
| GET | /api/stats/health | Sí | — | Indicadores de salud del negocio del mes: confirmación, no-show, cancelación y retención, con comparación con el mes anterior. |

## Horarios — `/api/schedules`

> (no verificado) Cuerpos, respuestas y descripciones de esta sección. Método, ruta y rol sí verificados.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/schedules | Sí | — | Lista los bloques de horario del negocio. Query: `professionalId?`. |
| POST | /api/schedules | Sí | ADMIN | Crea un bloque de horario. Body: `dayOfWeek` (1-7), `startTime`, `endTime`, `professionalId`, `isActive`. |
| PUT | /api/schedules/:id | Sí | ADMIN | Actualiza (parcial) un bloque de horario. |
| DELETE | /api/schedules/:id | Sí | ADMIN | Elimina un bloque de horario. |

## IA — `/api/ai`

Montaje con `requireAuth` y `requireStaff`: todos los endpoints exigen staff (ADMIN o PROFESSIONAL). `GET /spend-overview` además exige Super Admin.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| POST | /api/ai/chat | Sí | Staff | Procesa un mensaje con el cerebro del bot y devuelve su respuesta. Body: `message` (obligatorio), `channel?` (`WEB`, `TELEGRAM`, `WHATSAPP` o `VOICE`; por defecto `WEB`), `history?`, `clientId?`, `conversationId?`, `botId?`, `contactName?`, `contactPhone?`. Tope por negocio de 60 por minuto (`tenantRateLimit`; `429` si se supera). |
| POST | /api/ai/generate-prompt | Sí | Staff | Arma un prompt de sistema a partir del nombre del negocio y sus servicios activos. Body: `tone?` (`formal`, `amigable` o `directo`; por defecto `amigable`). Responde `{ prompt }`. No llama a ningún modelo. Tope por negocio de 10 por minuto (`429` si se supera). |
| GET | /api/ai/providers | Sí | Staff | Lista los proveedores de IA soportados y el proveedor por defecto (`defaultProvider`), según la configuración del servidor. |
| GET | /api/ai/engines | Sí | Staff | Catálogo de motores de IA con su estado para el negocio (cuál está activo, cuáles tienen key propia y cuáles están listos). Nunca expone las keys. |
| PUT | /api/ai/engine | Sí | Staff | Cambia el motor de IA activo del negocio. Body: `engineId`. Responde `400` si el motor es desconocido. |
| PUT | /api/ai/keys | Sí | Staff | Guarda o borra (con `apiKey` vacía) la API key propia del negocio para una familia de proveedor. Body: `provider` (una de las familias soportadas), `apiKey` (máx. 400). Responde `400` si el proveedor es desconocido. La key no se devuelve nunca. El almacenamiento cifrado es `(no verificado)`. |
| GET | /api/ai/system-prompt | Sí | Staff | Devuelve el prompt de sistema personalizado del negocio (`""` si no hay). Responde `{ prompt }`. |
| PUT | /api/ai/system-prompt | Sí | ADMIN | Guarda el prompt de sistema personalizado. Body: `prompt` (con límite de largo). Se inyecta en el prompt del chatbot en todos los canales. |
| GET | /api/ai/usage | Sí | Staff | Resumen de consumo de IA (tokens y costo estimado) por día y por modelo. Query: `days?` (1 a 365; por defecto 30). Cacheado 60 segundos. Forma de la respuesta: `(no verificado)`. |
| GET | /api/ai/quota | Sí | Staff | Cupo mensual de mensajes del bot: uso, límite del plan y restante. Forma de la respuesta: `(no verificado)`. |
| GET | /api/ai/spend-cap | Sí | Staff | Tope mensual de gasto de IA del negocio y cuánto lleva gastado este mes. Forma de la respuesta: `(no verificado)`. |
| PUT | /api/ai/spend-cap | Sí | ADMIN | Fija o quita el tope mensual de gasto de IA. Body: `capUsd` (número positivo, dentro del máximo permitido, o `null` para quitarlo). Responde el estado del tope. |
| GET | /api/ai/spend-overview | Sí | Super Admin | Gasto de IA del mes por negocio (con tope y nivel), hasta 200 negocios. Responde `{ month, totalUsd, businesses[] }`. Cruza todos los negocios. |

## Telegram — `/api/telegram`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| POST | /api/telegram/webhook/:businessId | No | — | Webhook público que recibe updates de Telegram. Autenticación: header `X-Telegram-Bot-Api-Secret-Token` comparado contra el `webhookSecret` guardado (esquema actual). Para conexiones anteriores sin `webhookSecret` se acepta el fallback legado `?token=`, comparado contra el token del bot. Sin conexión activa responde `200 { ok: true }`. Token inválido: `403`. Encola el update (sin Redis corre inline). |
| POST | /api/telegram/connect | Sí | — | Conecta un bot de Telegram y configura su webhook. Body: `botToken` (`(no verificado)` el resto de la respuesta). |
| DELETE | /api/telegram/disconnect | Sí | — | Desconecta el bot de Telegram del negocio. |
| GET | /api/telegram/status | Sí | — | Estado de la conexión de Telegram. |

## Configuración — `/api/settings`

> (no verificado) Cuerpos, respuestas y descripciones de esta sección. Método, ruta y rol sí verificados.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/settings | Sí | — | Devuelve la configuración del negocio (nombre, slug, timezone, tema, etc.). |
| PUT | /api/settings | Sí | ADMIN | Actualiza la configuración del negocio. Body: `businessName?`, `slug?`, `phone?`, `email?`, `address?`, `timezone?`, `currency?`, `theme?`, `accentColor?`. |

> Las keys de los proveedores de IA no se administran acá: ver `GET /api/ai/providers`, `GET /api/ai/engines` y `PUT /api/ai/keys`.

## Comandos — `/api/commands`

> (no verificado) Cuerpos, respuestas y descripciones de esta sección. Método, ruta y rol sí verificados.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/commands | Sí | — | Lista los comandos del negocio agrupados por categoría (siembra defaults si no hay). |

## Prompts — `/api/prompts`

> (no verificado) Cuerpos, respuestas y descripciones de esta sección. Método, ruta y rol sí verificados.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/prompts | Sí | — | Lista los prompts del negocio (siembra defaults si no hay). |
| POST | /api/prompts | Sí | ADMIN | Crea un prompt. Body: `name`, `category`, `content`, `isActive`. |
| PUT | /api/prompts/:id | Sí | ADMIN | Actualiza (parcial) un prompt. |
| DELETE | /api/prompts/:id | Sí | ADMIN | Elimina un prompt. |

## Habilidades — `/api/skills`

> (no verificado) Cuerpos, respuestas y descripciones de esta sección. Método, ruta y rol sí verificados.

Generado por la fábrica `createCatalogFeaturesRouter('skill')`.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/skills | Sí | — | Lista las habilidades del negocio (siembra defaults si no hay). |
| PUT | /api/skills/:name | Sí | ADMIN | Actualiza una habilidad por nombre. Body: `subtitle?`, `description?`, `iconName?`, `isActive?`. |

## Superpoderes — `/api/superpowers`

> (no verificado) Cuerpos, respuestas y descripciones de esta sección. Método, ruta y rol sí verificados.

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

> (no verificado) Cuerpos, respuestas y descripciones de esta sección. Método, ruta y rol sí verificados.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/plantillas-negocio | Sí | — | Lista las plantillas por giro/industria disponibles. |
| POST | /api/plantillas-negocio/:id/aplicar | Sí | ADMIN | Aplica una plantilla al negocio (crea servicios, prompt y activa superpoderes). |

## Bots — `/api/bots`

Montaje con `requireAuth` y `requireCapability('bots')`. Escrituras exigen ADMIN.

> (no verificado) Cuerpos y respuestas de esta sección.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/bots | Sí | — | Lista los bots del negocio (paginado). Query: `page`, `pageSize`. |
| GET | /api/bots/:id | Sí | — | Detalle de un bot con sus últimas conversaciones. |
| POST | /api/bots | Sí | ADMIN | Crea un bot. Body: `name`, `description?`, `channel`, `config?`. |
| PATCH | /api/bots/:id | Sí | ADMIN | Actualiza un bot. Body: `name?`, `description?`, `channel?`, `status?`, `config?`, `token?`, `webhookUrl?`. |
| DELETE | /api/bots/:id | Sí | ADMIN | Elimina un bot. |
| GET | /api/bots/:id/conversations | Sí | — | Lista las conversaciones de un bot (paginado). Query: `page`, `pageSize`. |

## FAQ — `/api/faq`

Montaje con `requireAuth` y `requireCapability('bots')`. `PUT` no exige un rol adicional: cualquier miembro con la capacidad `bots` puede reemplazar la base de conocimiento.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/faq | Sí | Capacidad `bots` | Lista las entradas de la base de conocimiento del bot. Responde `{ items }`. |
| PUT | /api/faq | Sí | Capacidad `bots` | Reemplaza la lista completa de entradas. Body: `items[]` (cada una con `question` y `answer` obligatorios, y `id?`; con límites de largo y cantidad). Responde `{ items }` ya saneado. |

## Onboarding — `/api/onboarding`

Montaje con `requireAuth`. Es información del propio negocio, sin capacidad específica.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/onboarding | Sí | — | Checklist de puesta en marcha calculado desde el estado real del negocio. |
| PUT | /api/onboarding/dismiss | Sí | — | Oculta o muestra el checklist. Body: `dismissed` (booleano). Responde el checklist actualizado. |

## Integraciones (solicitudes) — `/api/integrations`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/integrations/requests | Sí | — | Lista las integraciones que el negocio marcó como solicitadas. Responde `{ requested }`. |
| POST | /api/integrations/requests | Sí | ADMIN | Marca o desmarca una integración como solicitada. Body: `name` (1 a 100 caracteres), `requested?` (por defecto `true`). Responde `{ requested }` actualizado. |

## Marketplace — `/api/marketplace`

Montaje con `requireAuth` y `requireCapability('tools')`.

> (no verificado) Cuerpos y respuestas de esta sección. Método, ruta y rol sí verificados.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/marketplace/items | Sí | — | Lista los ítems del marketplace, marcando los instalados (siembra defaults). Query: `category?`, `search?`. |
| POST | /api/marketplace/items/:id/install | Sí | — | Instala un ítem del marketplace en el negocio. |
| DELETE | /api/marketplace/items/:id/install | Sí | — | Desinstala un ítem del marketplace del negocio. |

## Agencia — `/api/agency`

Sin middleware de montaje. Cada ruta aplica `requireCapability('agency')`; las escrituras además exigen ADMIN.

> (no verificado) Cuerpos y respuestas de esta sección. Método, ruta, capacidad y rol sí verificados.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/agency/stats | Sí | Capacidad `agency` | Métricas de la agencia (clientes, bots, facturación, código de referido). |
| GET | /api/agency/clients | Sí | Capacidad `agency` | Lista los clientes de la agencia (paginado). Query: `search?`, `page`, `pageSize`. |
| POST | /api/agency/clients | Sí | ADMIN, capacidad `agency` | Crea un cliente de agencia. Body: `name`, `plan?`, `status?`. |
| PATCH | /api/agency/clients/:id | Sí | ADMIN, capacidad `agency` | Actualiza un cliente de agencia. Body: `name?`, `plan?`, `status?`, `bots?`, `revenue?`. |
| DELETE | /api/agency/clients/:id | Sí | ADMIN, capacidad `agency` | Elimina un cliente de agencia. |

## Equipo — `/api/team`

Sin middleware de montaje. Cada ruta aplica `requireAuth`; las que cambian el equipo exigen ADMIN.

Las invitaciones se envían por mail con un link de un solo uso. El token se guarda hasheado y vence a los 7 días. Al canjearlo, el token se quema. Si el mail no sale, el miembro queda creado igual y la respuesta indica `emailSent: false`; en ese caso se usa `resend`.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/team/members | Sí | Staff | Lista los miembros del equipo del negocio con la fecha de vencimiento de su invitación pendiente. |
| POST | /api/team/invite | Sí | ADMIN | Invita a un miembro: lo crea en estado `PENDING` y manda el mail con el link de aceptación. Body: `name?`, `email`, `role` (`ADMIN`, `PROFESSIONAL` o `VIEWER`; por defecto `VIEWER`). Responde `201` con `emailSent` e `inviteExpiresAt`. `409` si el email ya es miembro o ya tiene cuenta activa en el negocio. Limitado. |
| POST | /api/team/members/:id/resend | Sí | ADMIN | Reenvía la invitación: emite un token nuevo (el anterior deja de servir) y vuelve a mandar el mail. Solo para miembros `PENDING`; `409` si ya aceptó. Responde `{ id, emailSent, inviteExpiresAt }`. Limitado. |
| PATCH | /api/team/members/:id | Sí | ADMIN | Cambia el rol del miembro. Body: `role` (único campo editable; el estado no se toca a mano). Sincroniza el rol del usuario y revoca sus sesiones abiertas. `409` si dejaría al negocio sin administradores. |
| DELETE | /api/team/members/:id | Sí | ADMIN | Quita al miembro: borra la fila, revoca su invitación pendiente y, si tenía cuenta, la da de baja y cierra sus sesiones. `409` si dejaría al negocio sin administradores. Responde `204` (o `200` con `revocationFailed: true` si no se pudieron cerrar las sesiones). |
| GET | /api/team/permissions | Sí | — | Catálogo de capacidades, defaults por rol, overrides del negocio, plan y capacidades del plan. Lo puede leer cualquier miembro autenticado. |
| GET | /api/team/my-access | Sí | — | Acceso efectivo del usuario que llama: capacidades de su rol (con su override) y las del plan del negocio. |
| PUT | /api/team/permissions/:memberId | Sí | ADMIN | Sobrescribe las capacidades de un miembro. Body: `permissions[]` (claves del catálogo). Un array vacío borra el override. Responde `{ memberId, role, permissions }`. |
| DELETE | /api/team/permissions/:memberId | Sí | ADMIN | Resetea las capacidades del miembro al default de su rol. |

## Analítica — `/api/analytics`

Montaje con `requireAuth`, `requireStaff` y `requireCapability('analytics')` (un `CLIENT` recibe `403`). Todas las rutas (salvo `/funnel`) aceptan el rango `?days=N` o `?from&to`, con el mismo formato que `/api/stats`. Por defecto usan 30 días, salvo `/conversations` (7), `/timeseries` (14) y `/funnel`, que no acepta rango. Las respuestas se cachean 30 segundos por negocio.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/analytics/kpi | Sí | — | KPIs del período con variación contra el período anterior de igual largo. `monthlyBudget` devuelve siempre `50` (valor fijo en el código). `avgSatisfaction` es una estimación, no calificaciones de clientes: la respuesta lleva `estimated: true` y `basis: "estado_de_conversaciones"`. |
| GET | /api/analytics/conversations | Sí | — | Conversaciones por día (7 días por defecto). Responde una entrada por día con `date`, `day` y `count`. |
| GET | /api/analytics/satisfaction | Sí | — | Distribución de satisfacción por estrellas, estimada a partir de los estados de las conversaciones y los tiempos de respuesta. Es una estimación: cada entrada lleva `estimated: true` y `basis: "estado_de_conversaciones"`. |
| GET | /api/analytics/improvements | Sí | — | Sugerencias heurísticas: respuesta del bot mayor a 3 s, escalamiento a humano mayor al 20 %, reservas pendientes mayores al 30 %, bot con menos del 30 % de los mensajes, o sin conversaciones. |
| GET | /api/analytics/costs | Sí | — | Costo estimado de IA por modelo. Es una estimación: el largo de los textos del bot dividido 4, repartido fijo 70 % / 30 % entre dos modelos con tarifas fijas. No es facturación real. |
| GET | /api/analytics/metrics | Sí | — | Métricas de desempeño del bot: tiempo de respuesta, mensajes por conversación, tasa de resolución, escalaciones y reservas por bot. |
| GET | /api/analytics/timeseries | Sí | — | Serie diaria (14 días por defecto, hora de Argentina) con `conversations` y `messages` nuevos por día. |
| GET | /api/analytics/funnel | Sí | — | Embudo CRM `NEW` → `HOT` → `PAYMENT` → `CUSTOMER` con `count`, `pctOfTotal` y `conversionFromPrev`. No acepta rango. |
| GET | /api/analytics/attribution | Sí | — | Atribución de Click-to-WhatsApp: cuántas conversaciones vinieron de un anuncio, desglose por origen y top 10 de anuncios. Sin rango cuenta todo el historial. |

## Campañas — `/api/campaigns`

Montaje con `requireAuth` y `requireCapability('marketing')`. Las escrituras exigen ADMIN.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/campaigns | Sí | — | Lista las campañas del negocio (paginado). Query: `page`, `pageSize`. |
| GET | /api/campaigns/recipients | Sí | — | Vista previa de los destinatarios: clientes con al menos una reserva en el negocio y con el dato de contacto que exige el canal. Query: `channel?` (`whatsapp`, `email`, `sms` o `telegram`). Responde `{ total, recipients }` (máx. 50 en la vista previa). |
| POST | /api/campaigns | Sí | ADMIN | Crea una campaña. Body: `name` (1 a 200), `description?` (máx. 1000), `channel` (`whatsapp`, `email`, `sms` o `telegram`; por defecto `whatsapp`), `scheduledAt?` (ISO 8601, debe ser futura con 1 minuto de tolerancia). Sin fecha nace en `draft`; con fecha nace en `scheduled`. Responde `201`. |
| PATCH | /api/campaigns/:id | Sí | ADMIN | Actualiza una campaña. Body: `name?`, `description?`, `status?` (`draft`, `scheduled` o `cancelled`; `sent` y `sending` los fija solo el motor de envío), `channel?`, `scheduledAt?` (ISO 8601 futura o `null` para quitar la programación: con fecha pasa a `scheduled`, con `null` desde `scheduled` vuelve a `draft`). `400` si ya fue enviada o se está enviando. Pasar a `scheduled` sin fecha (ni en el body ni guardada) responde `400`. |
| POST | /api/campaigns/:id/send | Sí | ADMIN | Envía la campaña ahora. Body: `message?` (máx. 2000; si falta se usa la descripción o el nombre). Hace un claim atómico (`draft` o `scheduled` pasa a `sending`) y encola el envío (con Redis responde `envio.enCola: true`; sin Redis corre inline). Solo WhatsApp y email tienen envío saliente real; `sms` y `telegram` cuentan todos sus destinatarios como fallidos. Al terminar queda `sent`; si agota 3 intentos, `failed`. Cada envío lleva un `runId` propio: un job viejo que sigue vivo no duplica mensajes (ver `docs/ESCALABILIDAD.md`). Responde `400` si ya fue enviada o se está enviando. |
| DELETE | /api/campaigns/:id | Sí | ADMIN | Elimina una campaña. Responde `204`. Si se está enviando (`sending`) responde `409` y no borra nada. |

**Campañas programadas:** un cron por minuto envía las campañas `scheduled` cuya fecha ya venció. Si la campaña lleva más de 6 horas de atraso, no se envía: pasa a `failed` para que el dueño decida reenviarla. Una campaña `sending` sin avance por más de 30 minutos también pasa a `failed` (reaper). Cada pase a `failed` emite el evento socket `campaign:failed` a la sala `business:<id>` con `{ campaign, envio?, reason }`, donde `reason` es `retries_exhausted`, `expired`, `stalled` o `error`.

## White-label — `/api/whitelabel`

Sin middleware de montaje.

> (no verificado) Cuerpos y respuestas de esta sección. Método, ruta y rol sí verificados.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/whitelabel | Sí | — | Devuelve la configuración de marca del negocio (logo, colores, redes). |
| PATCH | /api/whitelabel | Sí | ADMIN | Actualiza la marca. Body: `name?`, `description?`, `logo?`, `primaryColor?`, `secondaryColor?`, `accentColor?`, `customDomain?`, `phone?`, `whatsappNumber?`, `instagramUrl?`, `facebookUrl?`, `websiteUrl?`. |
| GET | /api/whitelabel/preview | Sí | — | Vista previa de la marca con servicios activos y URL pública. |

## Plantillas WhatsApp oficiales (HSM) — `/api/wa-templates`

Montaje con `requireAuth` y `requireCapability('marketing')`. La persistencia vive en la configuración de la conexión del negocio. `approve` y `reject` simulan la decisión de Meta: en esta versión la hace el ADMIN del negocio (no llega por webhook).

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/wa-templates | Sí | Capacidad `marketing` | Lista las plantillas del negocio. Responde `{ templates }`. |
| POST | /api/wa-templates | Sí | Capacidad `marketing` | Crea una plantilla en estado `DRAFT`. Body: `name` (minúsculas, dígitos y guion bajo), `language` (2 a 10 caracteres), `category` (`UTILITY`, `MARKETING` o `AUTHENTICATION`), `body` (1 a 1024), `header?` (máx. 60), `footer?` (máx. 60), `buttons?` (máx. 3; `QUICK_REPLY`, `URL` o `PHONE_NUMBER`; `value` obligatorio en `URL` y `PHONE_NUMBER`), `example?`. Responde `201`. `409` si el nombre ya existe. |
| PATCH | /api/wa-templates/:id | Sí | Capacidad `marketing` | Edita una plantilla en estado `DRAFT` o `REJECTED`. Si estaba `REJECTED`, limpia el motivo de rechazo. `409` en otros estados. |
| POST | /api/wa-templates/:id/submit | Sí | Capacidad `marketing` | Envía a aprobación: `DRAFT` o `REJECTED` pasa a `PENDING`. `422` si falta un ejemplo no vacío para cada variable del cuerpo. |
| POST | /api/wa-templates/:id/approve | Sí | ADMIN | Aprueba: `PENDING` pasa a `APPROVED`. `403` si el usuario no es ADMIN. `409` si no está en `PENDING`. |
| POST | /api/wa-templates/:id/reject | Sí | ADMIN | Rechaza: `PENDING` pasa a `REJECTED`. Body: `reason` (1 a 500). `403` si no es ADMIN. `409` si no está en `PENDING`. |
| DELETE | /api/wa-templates/:id | Sí | Capacidad `marketing` | Elimina una plantilla en cualquier estado. Responde `204`. |

## Mr Go (orquestador) — `/api/mrgo`

Sin middleware de montaje. Cada ruta aplica `requireAuth`; las que configuran el negocio globalmente exigen ADMIN. Las acciones externas (WhatsApp, cobros, campañas, reservas) se simulan salvo que se pida ejecución en vivo con `execute: true`. Las rutas en vivo son además at-most-once con `Idempotency-Key`.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/mrgo/agents | Sí | — | Agentes resueltos del negocio y los catálogos de roles, herramientas y herramientas permitidas por rol. |
| PUT | /api/mrgo/agents | Sí | — | Configura qué agentes están activos, su motor opcional y su personalización (nombre, color, emoción, mascota, herramientas). Body: `agents[]` (cada uno con `key`). El servicio valida contra los catálogos. |
| POST | /api/mrgo/orchestrate | Sí | — | Decide qué agente atiende un input y qué herramienta proponer. Body: `text` (1 a 4000), `channel?`, `execute?`. Con `execute: true` ejecuta la herramienta propuesta en vivo; por defecto solo rutea y simula. Tope por negocio de 30 por minuto (`429` si se supera). |
| POST | /api/mrgo/run | Sí | — | Loop agéntico: encadena herramientas hasta resolver el pedido o pausar. Body: `text`, `channel?`, `execute?`, `maxSteps?` (1 a 10), `agentKey?` (fuerza el agente; si falta, el CEO rutea). Sin `execute` corre en dry-run. Con `execute: true` corre en vivo y las acciones externas pausan el loop con `stoppedReason: "needs_confirmation"` para confirmarlas con `/confirm`. Tope por negocio de 12 por minuto (`429` si se supera). |
| POST | /api/mrgo/confirm | Sí | — | Confirma y ejecuta en vivo una acción que el loop dejó pendiente. Body: `tool` (obligatorio), `params?`, `thought?`, `resume?` (`text`, `channel?`, `agentKey`, `steps?`, `maxSteps?`). Con `resume` reanuda la cadena. `400` si la herramienta es desconocida. Tope por negocio de 12 por minuto (`429` si se supera). |
| GET | /api/mrgo/memory | Sí | — | Memoria del negocio (perfil y hechos) que usa el orquestador como contexto. |
| PUT | /api/mrgo/memory | Sí | ADMIN | Edita la memoria del negocio. Body: `profile?`, `facts?` (con límites de largo y cantidad). |
| GET | /api/mrgo/office | Sí | — | Estado persistente de la oficina (agentes en pausa y posiciones en el piso). |
| PUT | /api/mrgo/office | Sí | — | Guarda el estado de la oficina. Body: `paused[]` (claves de agentes) y `positions?` (`{ x, y }` por agente). |
| GET | /api/mrgo/industry | Sí | — | Giro del negocio para el tono de los agentes. |
| PUT | /api/mrgo/industry | Sí | ADMIN | Guarda el giro del negocio. Body: `giroId` (`""` limpia el giro). No crea servicios ni skills: eso lo hace `POST /api/plantillas-negocio/:id/aplicar`. |

## Workflows (automatizaciones) — `/api/workflows`

Montaje con `requireAuth` y `requireStaff` (un `CLIENT` con JWT recibe `403`: antes podía leer las reglas del negocio). Cada regla sigue el esquema trigger → condición → acción. Las escrituras y las ejecuciones exigen ADMIN, porque en modo en vivo producen efectos reales (por ejemplo, enviar un WhatsApp).

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/workflows | Sí | — | Lista las reglas del negocio y los catálogos de triggers, acciones (con los `params` que pide cada una) y variables para la UI. |
| POST | /api/workflows | Sí | ADMIN | Crea una regla. Body: `nombre` (obligatorio), `trigger` (obligatorio, del catálogo), `accion` (obligatoria, del catálogo), `condicion?`, `activo?`, `params?` (strings, validados contra la acción). Responde `201`; `400` si los datos son inválidos o se alcanzó el límite de reglas. |
| PATCH | /api/workflows/:id | Sí | ADMIN | Edita una regla (incluye activar o desactivar con `activo`). Body parcial, con al menos un campo. `404` si no existe. |
| DELETE | /api/workflows/:id | Sí | ADMIN | Elimina una regla. Responde `204`; `404` si no existe. |
| POST | /api/workflows/run | Sí | ADMIN | Dispara las reglas de un trigger y devuelve qué hizo cada acción. Body: `trigger`, `payload?`, `execute?`. Por defecto simula (dry-run); con `execute: true` corre en vivo. |
| GET | /api/workflows/settings | Sí | — | Indica si los disparos automáticos del pipeline corren en vivo. Responde `{ live }`. |
| PUT | /api/workflows/settings | Sí | ADMIN | Activa o desactiva la ejecución en vivo de las automatizaciones automáticas. Body: `live` (booleano). Responde `{ live }`. |

## MCP (Model Context Protocol) — `/api/mcp`

Sin middleware de montaje. Protocolo JSON-RPC 2.0 sobre HTTP. Cada request trae el JWT del negocio y todo se ejecuta acotado a su `businessId`.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| POST | /api/mcp | Sí | — | Endpoint MCP. Soporta `initialize`, `tools/list`, `tools/call` y `ping`. Acepta un mensaje único o un batch (array). Si el body contiene solo notificaciones, responde `202` sin cuerpo. El modo por defecto para acciones externas es el del negocio: dry-run salvo que tenga automatizaciones en vivo. |

## Super Admin (plataforma) — `/api/platform`

Montaje con `requireAuth` y `requirePlatformAdmin`. Es cross-tenant: opera sobre todos los negocios, no sobre el del token. Quien entra debe tener su email en la allowlist `PLATFORM_ADMIN_EMAILS`. Si la lista está vacía o no se puede leer el usuario, se niega el acceso (falla cerrado).

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/platform/businesses | Sí | Super Admin | Lista paginada de negocios con plan, estado de suscripción y conteos. Query: `page`, `pageSize` (máx. 100), `search?` (nombre o slug). |
| PATCH | /api/platform/businesses/:id/active | Sí | Super Admin | Suspende o reactiva un negocio. Body: `isActive` (booleano). |
| PATCH | /api/platform/businesses/:id/plan | Sí | Super Admin | Fija el plan del negocio sin pasar por la pasarela de pago. Body: `tier` (`FREE`, `STARTER`, `PRO` o `ENTERPRISE`). Deja la suscripción `ACTIVE` con un período de un año e invalida la caché de capacidades. |
| GET | /api/platform/businesses/:id/features | Sí | Super Admin | Feature flags del negocio y el catálogo disponible. |
| PUT | /api/platform/businesses/:id/features | Sí | Super Admin | Guarda los feature flags del negocio. Body: `flags` (solo se guardan las claves del catálogo). |

## Chat y reservas públicas — `/api/public`

Router montado con CORS abierto (`origin: true`, sin credenciales, `maxAge` 7200 s). Ningún endpoint requiere autenticación: son de cara al widget público y al cliente final.

**Token de lectura del chat:** al abrir una conversación nueva, `POST /chat` devuelve un `chatToken` (única vez que se emite). Solo se guarda su hash en la conversación. Para leer las respuestas de esa conversación hay que enviarlo en el header `X-Chat-Token`.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/public/bot/demo | No | — | Devuelve un bot activo cualquiera para la demo pública. `404` si no hay ninguno. |
| GET | /api/public/bot/:botId | No | — | Datos públicos de un bot. `404` si no existe o está en `DRAFT`. |
| POST | /api/public/chat | No | — | Chat público con un bot. Body: `message` (1 a 2000), `botId`, `conversationId?` (solo se acepta con su `chatToken` válido; si no, se abre una conversación nueva), `chatToken?`, `contactName?`, `contactPhone?`, `imageUrl?`, `imageUrls?` (máx. 4; solo `http` o `https`). Responde con el texto del bot y `chatToken` cuando la conversación es nueva. Si el bot no está activo o el negocio superó su tope diario, responde un mensaje cortés sin llamar a la IA. Topes diarios por negocio: 1000 mensajes y 300 con imágenes. |
| GET | /api/public/chat/:botId/messages | No (token de lectura) | — | Polling de respuestas nuevas de la conversación, humanas y del bot, para el widget. Header `X-Chat-Token` (preferido; `?token=` queda solo por compatibilidad). Query: `conversationId` (obligatorio), `after?` (ISO 8601 o id de un mensaje ya recibido). Devuelve hasta 50 mensajes con rol `BOT` (`fromHuman` indica los de un agente) y `hasMore`. Sin acceso válido responde `404` genérico, que no distingue "no existe" de "token inválido". Límites: 60 requests por minuto por IP y 30 por minuto por conversación (`429`). Responde `Cache-Control: no-store`. |
| GET | /api/public/book/:slug | No | — | Datos públicos de reserva de un negocio (servicios, horarios, profesionales). |
| GET | /api/public/book/:slug/slots | No | — | Slots disponibles para reservar. Query: `date`, `serviceId`, `professionalId?`. |
| POST | /api/public/book/:slug/request-otp | No | — | Envía un código OTP por WhatsApp para verificar el teléfono. Body: `phone`. |
| POST | /api/public/book/:slug | No | — | Crea una reserva pública, con verificación OTP opcional y reserva atómica. Body: `serviceId` (obligatorio), `professionalId?`, `date` (YYYY-MM-DD), `time` (HH:MM), `name`, `phone`, `email?`, `otp?`. |

## Webhooks de MercadoPago — `/api/mercadopago/webhook/:businessId`

Webhook **público** de confirmación de pagos. Se monta antes del límite global por IP, porque llega desde IPs compartidas. Su cuerpo se limita a 100 KB.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| POST | /api/mercadopago/webhook/:businessId | No | — | Notificación de pago (formato v1: `type` y `data.id`). El cuerpo no se confía: de ahí sale solo el id del pago, que se consulta a la API de MercadoPago con el token de ese negocio. Temas que no son de pago responden `200`. Sin id de pago válido responde `400`. Si el negocio configuró una clave secreta de webhook, la firma `x-signature` es obligatoria: si no valida, responde `401`. Un negocio sin MercadoPago conectado o deshabilitado responde `200`. Errores transitorios responden `503` para que MercadoPago reintente. Idempotente por id de pago. |
| GET | /api/mercadopago/webhook/:businessId | No | — | Mismo manejo, en formato IPN legado (`?topic=payment&id=...`). |
| POST/GET | /api/mercadopago/webhook (sin businessId) | No | — | Responde `400`: la URL debe incluir el negocio. |

Topes: 600 requests por minuto por IP, 300 avisos verificados por minuto por negocio y 30 intentos inválidos por minuto por IP y negocio (`429`).

## Voz (Twilio Voice) — `/api/voice`

Sin middleware de montaje. Los webhooks de Twilio llegan como `application/x-www-form-urlencoded` y validan la firma. Están exentos del límite global por IP.

> (no verificado) Cuerpos y respuestas de la configuración de voz. Método, ruta, auth y rol sí verificados.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/voice/status | Sí | — | Diagnóstico de la configuración de voz de Twilio del negocio. |
| GET | /api/voice/config | Sí | — | Devuelve la configuración de voz del negocio (idioma, voz, saludos). |
| PUT | /api/voice/config | Sí | ADMIN | Actualiza la configuración de voz. Body: `enabled?`, `assistantName?`, `language?`, `voice?`, `rate?`, `greeting?`, `closing?`, `reprompt?`, `persona?`. |
| POST | /api/voice/incoming | No | — | Webhook de Twilio al entrar una llamada; responde TwiML con el saludo (valida firma). |
| POST | /api/voice/respond | No | — | Webhook de Twilio con la transcripción del cliente; procesa con IA y responde por voz (valida firma). |

## Voz de marca — `/api/brand`

Sin middleware de montaje.

> (no verificado) Cuerpos y respuestas de esta sección. Método, ruta y rol sí verificados.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/brand | Sí | — | Devuelve la Voz de Marca del negocio. |
| PUT | /api/brand | Sí | ADMIN | Actualiza (merge parcial) la Voz de Marca. Body: `tono?`, `publicoObjetivo?`, `infoNegocio?`, `reglas?`, `emojis?`. |

## Galería — `/api/galeria`

Sin middleware de montaje. Escrituras exigen ADMIN.

> (no verificado) Cuerpos y respuestas de esta sección. Método, ruta y rol sí verificados.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/galeria | Sí | — | Lista los ítems de la galería del negocio. |
| POST | /api/galeria | Sí | ADMIN | Agrega un ítem a la galería. Body: `url`, `tipo` (`image`, `video` o `audio`), `titulo?`, `descripcion?`. |
| DELETE | /api/galeria/:itemId | Sí | ADMIN | Elimina un ítem de la galería. |

## Integraciones (conectores por negocio)

Conectores de servicios externos que cada negocio configura desde el panel de **Conexiones**. La credencial se valida contra el proveedor al conectar y se guarda por negocio, cifrada (el algoritmo de cifrado es `(no verificado)`). Los endpoints de `status` nunca exponen la credencial. Conectar y desconectar requieren rol **ADMIN**; consultar estado y operar (generar links, etc.) basta con estar autenticado.

> Las credenciales de integraciones **no** se cargan por `.env`: son por negocio y se administran desde el panel. Ver `DEPLOY.md`.

### Cal.com (agenda externa) — `/api/calcom`

Sin middleware de montaje. Conectar y desconectar exigen ADMIN.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/calcom/status | Sí | — | Estado de la conexión (sin exponer la API key). Devuelve `{ connected, enabled, eventTypeId }`. |
| GET | /api/calcom/event-types | Sí | — | Lista los tipos de evento de la cuenta conectada (requiere estar conectado). |
| POST | /api/calcom/connect | Sí | ADMIN | Valida la API key contra Cal.com y la guarda. Body: `apiKey`, `eventTypeId?` (entero). |
| POST | /api/calcom/disconnect | Sí | ADMIN | Borra la conexión. Devuelve `{ connected: false, enabled: false, eventTypeId: null }`. |

### MercadoPago (pagos) — `/api/mercadopago`

Montaje sin middleware. Cada ruta aplica su propio requisito.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/mercadopago/status | Sí | Staff | Estado de la conexión (sin exponer el access token). Devuelve `{ connected, enabled, currency }`. |
| POST | /api/mercadopago/connect | Sí | ADMIN | Valida el access token contra MercadoPago y lo guarda. Body: `accessToken`, `currency?` (código ISO de 3 letras), `webhookSecret?` (si se guarda, el webhook exige firma válida). |
| POST | /api/mercadopago/webhook-secret | Sí | ADMIN | Fija o quita la clave secreta del webhook. Body: `webhookSecret` (`null` o vacío la quita). |
| POST | /api/mercadopago/disconnect | Sí | ADMIN | Borra la conexión. Devuelve `{ connected: false, enabled: false, currency: "ARS" }`. |
| POST | /api/mercadopago/payment-link | Sí | Staff, capacidad `sales` | Genera un link de cobro (preferencia de Checkout Pro). Requiere estar conectado. Body: `amount` (mayor a 0), `description` (1 a 200), `currency?`. Responde `{ url, id }` (`(no verificado)` la forma exacta). |

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
| POST | /api/composio/connect | Sí | ADMIN | Valida la API key contra Composio y la guarda. Body: `apiKey`. |
| POST | /api/composio/disconnect | Sí | ADMIN | Borra la conexión. Devuelve `{ connected: false, enabled: false }`. |

## Arena — `/api/arena`

Montaje con `requireAuth` y `requireCapability('tools')`. Las escrituras de builders exigen ADMIN.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/arena/builders | Sí | — | Lista los "builders" (constructores de bots) del negocio. |
| POST | /api/arena/builders | Sí | ADMIN | Crea un builder. Body: `name` (1 a 100), `title?` (máx. 200), `github?`, `description?` (máx. 500), `systemPrompt?` (máx. 5000), `model?` (máx. 100), `temperature?` (de 0 a 2). Responde `201`. |
| PATCH | /api/arena/builders/:id | Sí | ADMIN | Actualiza un builder. Body parcial (`(no verificado)` el schema de actualización). |
| DELETE | /api/arena/builders/:id | Sí | ADMIN | Elimina un builder. Responde `204`. |
| POST | /api/arena/builders/:id/vote | Sí | — | Suma un voto al builder. Un voto por usuario y por builder; `409` si ya votó. |
| GET | /api/arena/ideas | Sí | — | Lista las ideas del negocio ordenadas por votos. |
| POST | /api/arena/ideas | Sí | — | Crea una idea. Body: `title` (1 a 200), `description?` (máx. 2000), `category?` (máx. 50). Responde `201`. |
| POST | /api/arena/ideas/:id/vote | Sí | — | Suma un voto a una idea. Un voto por usuario y por idea; `409` si ya votó. |
| POST | /api/arena/chat | Sí | — | "Probar bot": responde con el bot real del negocio, con el mismo motor que `/api/ai/chat`, la cuota de mensajes del plan y el tope por negocio. Body: `message` (1 a 2000), `builderId?` (si viene, su `systemPrompt` se suma al prompt del bot; `404` si no es de este negocio), `conversationId?` (para mantener el historial de la charla de prueba). Responde `{ reply, intent, actions, conversationId }`. Tope por negocio de 60 por minuto (`429` si se supera). |

## Conversaciones — `/api/conversations`

Montaje con `requireAuth`, `requireStaff` y `requireCapability('conversations')`.

### Estados de atención

El estado de atención de una conversación no tiene columna propia: se deriva de `status` (`OPEN`, `HANDOFF` o `CLOSED`) y de flags en la metadata. Toda transición pasa por una sola función, con un lock por fila, así que dos agentes no se pisan.

| Estado | Representación | ¿Responde el bot? |
|--------|----------------|-------------------|
| `BOT` | `OPEN`, sin `botPaused` | Sí |
| `ESPERANDO` | `HANDOFF`, sin `botPaused` (espera que alguien la tome) | No |
| `HUMANO` | `OPEN` con `botPaused` en `true` (un agente la atiende) | No |
| `CERRADA` | `CLOSED` | — (no se reabre sola) |

**Transiciones por endpoint:**

- **`take`** (`POST /:id/take`): pasa a `HUMANO`. Si la tiene otro agente responde `409 TAKEN_BY_OTHER`, salvo que un ADMIN use `?force=true`. Sobre `CERRADA` responde `409 CONVERSATION_CLOSED`.
- **`reply`** (`POST /:id/reply`): pasa a `HUMANO` y la saca de `ESPERANDO` en la misma operación. Conserva al agente que la tomó primero. Sobre `CERRADA` responde `409 CONVERSATION_CLOSED`.
- **`release`** (`POST /:id/release`): devuelve la conversación a `BOT` (desde `HUMANO` o `ESPERANDO`). Sobre `CERRADA` no cambia nada y responde `200`.
- **`close`** (`PATCH /:id/close`): cierra la conversación desde `BOT`, `ESPERANDO` o `HUMANO` (o sea, `OPEN` o `HANDOFF`) y limpia todo el rastro de atención. Si ya está cerrada responde `404`.
- **Plazos:** la evaluación es perezosa (se hace cuando llega un mensaje del cliente). Una conversación `HUMANO` vuelve a `BOT` tras 30 minutos sin acción humana. Una `ESPERANDO` vuelve a `BOT` tras 15 minutos sin que nadie la tome. Los plazos son fijos para todos los negocios.
- **Handoff:** la transición a `ESPERANDO` la dispara el chatbot; no tiene ruta HTTP propia. `(no verificado)` el detalle de cada disparador.

### Endpoints

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/conversations | Sí | Staff | Lista conversaciones con último mensaje y canal efectivo. Query: `page` (por defecto 1), `pageSize` (máx. 50, por defecto 20), `status?`, `channel?`, `view?` (`all`, `attention`, `unread`, `leads`), `search?` (nombre, teléfono o email, máx. 100 caracteres). `view=attention` filtra `HANDOFF` y reemplaza el filtro de `status`; `view=unread` muestra las que el usuario actual nunca abrió; `view=leads` muestra las etiquetadas como lead o interesado. |
| GET | /api/conversations/:id | Sí | Staff | Detalle de una conversación con sus mensajes. Query: `limit?` (máx. 200) y `before?` (id de mensaje, cursor). Con `limit` devuelve los N más recientes en orden cronológico y `hasMoreMessages`. Sin `limit` devuelve el hilo completo. |
| POST | /api/conversations/:id/reply | Sí | Staff | Responde manualmente. Body: `text` (1 a 5000). Guarda el mensaje y lo envía al canal real. Pasa la conversación a `HUMANO`. Si el envío falla, el mensaje queda guardado y la respuesta es `200` con `deliveryStatus: "failed"` y `deliveryError`. Soporta `Idempotency-Key` (un reintento responde `200` con `{ duplicate: true }`). Tope por negocio de 60 por minuto (`429` si se supera). |
| POST | /api/conversations/:id/reply/:messageId/retry | Sí | Staff | Reintenta el envío de una respuesta humana que falló. No crea un mensaje nuevo. Un envío `pending` de más de 60 segundos se considera colgado y se puede reintentar. Máximo 5 intentos (`409 MAX_ATTEMPTS`). `409 NOT_FAILED` si no está fallido. `404` si el mensaje no es una respuesta humana. Tope por negocio de 60 por minuto (`429` si se supera). |
| PATCH | /api/conversations/:id/close | Sí | Staff | Cierra la conversación (ver transiciones). |
| PATCH | /api/conversations/:id/assign | Sí | Staff | Asigna o desasigna la conversación a un miembro del equipo. Body: `assignedTo?` (id de miembro; `null` desasigna). `404` si el miembro no es del negocio. |
| PATCH | /api/conversations/:id/tags | Sí | Staff | Reemplaza las etiquetas de la conversación. Body: `tags[]` (máx. 20; cada una de 1 a 40 caracteres). Se normalizan (sin espacios ni duplicados sin importar mayúsculas). |
| POST | /api/conversations/:id/notes | Sí | Staff | Agrega una nota interna del equipo, que el cliente no ve. Body: `text` (1 a 2000). Se guardan hasta 200 notas por conversación. |
| PATCH | /api/conversations/:id/read | Sí | Staff | Marca la conversación como leída por el usuario actual. |
| POST | /api/conversations/:id/take | Sí | Staff | Toma la conversación (ver transiciones). Query: `force?` (solo ADMIN). Responde `{ metadata, status }`. |
| POST | /api/conversations/:id/release | Sí | Staff | Devuelve la conversación al bot (ver transiciones). Responde `{ metadata, status }`. |
| POST | /api/conversations/:id/copilot | Sí | Staff | Copiloto del inbox: genera un resumen y una respuesta sugerida para el agente. Es de solo lectura: no crea mensajes ni envía nada. Responde `503` si el motor de IA no está disponible. Tope por negocio de 30 por minuto (`429` si se supera). Forma de la respuesta: `(no verificado)`. |
| POST | /api/conversations/:id/lead-score | Sí | Staff | Calcula el puntaje de intención de compra del cliente (temperatura, puntaje y motivo) y lo guarda en la metadata de la conversación. Responde `503` si el motor de IA no está disponible. Tope por negocio de 30 por minuto (`429` si se supera). Forma exacta de la respuesta: `(no verificado)`. |

## WhatsApp — `/api/whatsapp`

Sin middleware de montaje.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/whatsapp/status | Sí | — | Indica si el canal de WhatsApp (Twilio) está configurado. |
| POST | /api/whatsapp/webhook | No | — | Webhook entrante de Twilio (valida firma `X-Twilio-Signature`; body url-encoded). Exento del límite global por IP. |
| POST | /api/whatsapp/send | Sí | Staff | Envía un mensaje de WhatsApp desde el número del negocio. Body: `to`, `message` (`(no verificado)` el schema). |

## Meta (Instagram / Messenger) — `/api/meta`

Sin middleware de montaje.

> (no verificado) Cuerpos y respuestas de `connect`, `disconnect` y `status`. Método, ruta y rol sí verificados.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/meta/webhook | No | — | Verificación del webhook de Meta (devuelve `hub.challenge`). Query: `hub.mode`, `hub.verify_token`, `hub.challenge`. |
| POST | /api/meta/webhook | No | — | Eventos entrantes de mensajería de Meta (valida firma `X-Hub-Signature-256`). Exento del límite global por IP. |
| POST | /api/meta/connect | Sí | — | Conecta una página de Facebook o cuenta de Instagram. Body: `platform`, `pageAccessToken`, `pageId?`, `igId?`, `pageName?`. |
| DELETE | /api/meta/disconnect | Sí | — | Desconecta una plataforma. Query: `platform` (`instagram`/`messenger`). |
| GET | /api/meta/status | Sí | — | Estado de las conexiones de Instagram y Messenger. |

## Facturación — `/api/billing`

Salvo el webhook, todas las rutas requieren autenticación **y** rol ADMIN (`router.use(requireAuth, requireRole('ADMIN'))`). El webhook se registra antes de ese `use`.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| POST | /api/billing/webhook | No | — | Webhook de Stripe (valida firma sobre el cuerpo crudo). Exento del límite global por IP. |
| GET | /api/billing/plans | Sí | ADMIN | Lista los planes activos. |
| GET | /api/billing/subscription | Sí | ADMIN | Devuelve la suscripción actual del negocio. |
| GET | /api/billing/limits | Sí | ADMIN | Límites del plan del negocio y su uso actual (`(no verificado)` la forma de la respuesta). |
| POST | /api/billing/subscribe | Sí | ADMIN | Crea una sesión de checkout de Stripe. Body: `planId`, `interval` (`monthly` o `yearly`; por defecto `monthly`). |
| POST | /api/billing/payment-link | Sí | ADMIN | Genera un link de pago de una sola vez. Body: `amount` (mayor a 0, máx. 1.000.000), `description` (1 a 200), `currency?`. |
| POST | /api/billing/portal | Sí | ADMIN | Crea una sesión del portal de facturación de Stripe. |
| POST | /api/billing/cancel | Sí | ADMIN | Cancela la suscripción del negocio. |
| GET | /api/billing/invoices | Sí | ADMIN | Lista las últimas facturas del negocio. |

## Planes (público) — `/api/plans`

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/plans/public | No | — | Lista pública de planes activos (para la landing/pricing). |

## Plantillas de mensaje — `/api/templates`

Sin middleware de montaje.

> (no verificado) Cuerpos y respuestas de esta sección. Método, ruta y rol sí verificados.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/templates | Sí | — | Lista las plantillas del negocio. Query: `type?`. |
| POST | /api/templates | Sí | — | Crea una plantilla. Body: `name`, `description?`, `content`, `category?`, `type` (`whatsapp`/`business`). |
| PATCH | /api/templates/:id | Sí | — | Actualiza (parcial) una plantilla. |
| DELETE | /api/templates/:id | Sí | — | Elimina una plantilla. |

## Webhooks (salientes) — `/api/webhooks`

Sin middleware de montaje.

> (no verificado) Cuerpos y respuestas de esta sección. Método, ruta y rol sí verificados.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/webhooks | Sí | — | Lista los webhooks configurados por el negocio. |
| GET | /api/webhooks/events | Sí | — | Lista los tipos de evento disponibles para suscribir. |
| POST | /api/webhooks | Sí | — | Crea un webhook (valida URL anti-SSRF). Body: `name`, `url`, `events[]`, `secret?`. |
| PATCH | /api/webhooks/:id | Sí | — | Actualiza un webhook (valida URL anti-SSRF). Body: `name?`, `url?`, `events?`, `secret?`, `isActive?`. |
| DELETE | /api/webhooks/:id | Sí | — | Elimina un webhook. |
| POST | /api/webhooks/:id/test | Sí | — | Envía una petición de prueba al webhook (valida URL anti-SSRF). |

## Punto de venta (POS) — `/api/pos`

> (no verificado) Respuesta de esta sección. Método, ruta y rol sí verificados.

| Método | Ruta | Auth | Rol | Descripción |
|--------|------|------|-----|-------------|
| GET | /api/pos/items | Sí | — | Lista servicios activos y productos con stock como ítems vendibles del POS. |

---

## Referencia rápida de errores de negocio

| Código HTTP | `code` | Dónde | Significado |
|-------------|--------|-------|-------------|
| 409 | `CONVERSATION_CLOSED` | `/api/conversations/:id/reply`, `/retry`, `/take` | La conversación está cerrada: no se puede responder ni tomar. |
| 409 | `TAKEN_BY_OTHER` | `/api/conversations/:id/take` | Otro agente ya tiene la conversación. Lo puede forzar un ADMIN con `?force=true`. |
| 409 | `NOT_FAILED` | `/api/conversations/:id/reply/:messageId/retry` | El mensaje no tiene un envío fallido, o ya se está reintentando o enviando. |
| 409 | `MAX_ATTEMPTS` | `/api/conversations/:id/reply/:messageId/retry` | Se alcanzó el tope de 5 intentos de envío. |
| 409 | `PRODUCT_STALE` | `PUT /api/products/:id` | Se mandó `expectedUpdatedAt` y el producto cambió desde entonces: recargar y reintentar. |
| 409 | (sin `code`) | `POST /api/orders`, `POST /api/transactions` | La `Idempotency-Key` ya se usó con otro contenido. |
| 409 | (sin `code`) | `PATCH /api/bookings/:id/status` | La reserva está en un estado final (`CANCELLED`, `COMPLETED`, `NO_SHOW`) y no se reabre. |
| 409 | (sin `code`) | `DELETE /api/campaigns/:id` | La campaña se está enviando (`sending`). |
| 409 | `CATEGORY_IN_USE` | `DELETE /api/categories/:id` | La categoría tiene productos o servicios. Se puede borrar con `?detach=true`. |
| 409 | `DUPLICATE_REQUEST` | `/api/mrgo/orchestrate`, `/run`, `/confirm` | Reintento de una acción en vivo con la misma `Idempotency-Key`. |
| 403 | `PLAN_LIMIT_REACHED` | `POST /api/clients` | Se alcanzó el máximo de contactos del plan. |
| 403 | (capacidad) | Rutas con `requireCapability` | Respuesta con `{ error, capability, planTier }`. |

