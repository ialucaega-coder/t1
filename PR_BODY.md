# Local B — endurecimiento, escalado, integraciones, 2FA y migración Next 16 + React 19

Rama `fix/dev-cors-autoport` → `main`. Trae el proyecto a un estado **feature-complete, CI-green y listo para beta**, con paridad (o mejor) frente a ForjaBots, endurecido tras una auditoría de seguridad (0 CRITICAL / 0 HIGH confirmados por code-review) y verificado corriendo end-to-end.

## Qué incluye

### 🔐 Seguridad
- **2FA por TOTP** (Google Authenticator/Authy/1Password): setup con QR, verificación, desactivación y segundo factor en el login. Secreto cifrado en reposo (AES-256-GCM, `lib/crypto.ts`).
- **CRITICAL — ReDoS en el sanitizer (DoS sin auth):** el saneador de inputs usaba regex con backtracking catastrófico (`<script ...>` O(n³), `<a ...>` O(n²)) sobre TODO el body JSON **antes** de autenticar; un POST con miles de `<script`/`<a` sin cerrar bloqueaba el event loop por segundos/minutos. Reemplazado por un stripper de tags lineal O(n) que solo trata `<` como etiqueta si lo sigue `[a-zA-Z/!?]` (no corrompe texto legítimo con `<`/`>`). + test de regresión con cota de tiempo.
- **CRITICAL — Socket.IO sin autenticar (fuga cross-tenant en tiempo real):** el handshake no validaba nada y `join-business` aceptaba cualquier `businessId`, así que un cliente podía recibir en vivo reservas (con PII) y mensajes de chat de otro negocio. Ahora `io.use()` exige el JWT en el handshake y une el socket **solo** a la room de su negocio (deriva `businessId` del token e ignora el que mande el cliente); el cliente web envía el token en `auth`.
- **Credenciales de terceros cifradas en reposo (AES-256-GCM):** AI keys por negocio, Page Access Token de Meta, botToken de Telegram, secret de webhooks y la API key de `ai_provider` — antes quedaban en texto plano en `Connection.config`. Migración perezosa (`safeDecrypt` lee las legadas) + script de backfill (`npm run backfill:credentials`). El `GET /webhooks` ya no devuelve el secret (solo `hasSecret`).
- **Telegram sin token en la URL (H2):** el webhook ya no lleva el botToken en el query string (quedaba en access logs/auditoría); se usa el `secret_token` de Telegram, validado timing-safe por el header `X-Telegram-Bot-Api-Secret-Token`. Backward-compat con las conexiones legadas.
- **Rate limit con buckets separados:** `auth` y `api` compartían contador por IP, así que ~10 requests de API bloqueaban el login; ahora cada uno tiene su namespace, tope global subido a 300/15min, y los webhooks firmados (Stripe/Meta/Telegram/Twilio/ManyChat) quedan exentos del límite por IP.
- **Anti-hijack de número WhatsApp/voz:** resolución determinista (por antigüedad del negocio) + unicidad al guardar (409 + advisory lock) para que un número no pertenezca a dos negocios.
- **OTP atómico** (advisory lock → no se saltea el tope de 5 intentos en paralelo); **guarda de stock** (no vender en negativo); **reserva pública validada con zod** (type-confusion: `phone` como objeto → inyección de operadores Prisma); **Telegram** con email sintético scopeado por negocio (corta el cruce de clientes entre tenants); **anti-SSRF** en webhooks (`redirect:'manual'` + validación de host).
- Cierre de **IDOR cross-tenant** en el lookup de cliente del chatbot; **fail-closed** en la verificación de webhooks de Meta; `images.remotePatterns` acotado a Supabase (cierra el proxy de imágenes abierto / vector del DoS del Image Optimizer).
- Warning de `META_APP_SECRET`, TTL de sesión configurable (`JWT_EXPIRES_IN`), DevSecOps (Dependabot, `npm audit`, CodeQL), lockout de cuenta y auditoría de eventos de auth.

### 🚀 Migración Next 16 + React 19
- **`next 14.2 → 16.3.8`, `react/react-dom 18 → 19.3`, `@sentry/nextjs 10 → 11`, `lucide-react 0.577`**, etc. Cierra el **crítico de Next.js** del `npm audit` (DoS en Image Optimizer / RSC / rewrites / cache): el audit de prod baja de **13 vulns (1 crítica)** a **5 (0 críticas)** y Next ya no aparece.
- Se quitó `next-auth` (no se usaba; arrastraba React 18). Compat: tipos de React 19 (`useRef`), y `overrides` de `react`/`react-dom` 19.3.0 en el root para forzar una sola copia en el monorepo (evita el mismatch con `@testing-library/react`).
- Las páginas server ya usaban async `params` (listas para Next 16); sin `next/headers` ni route handlers que migrar.

### ⚡ Escalabilidad
- **Redis opt-in** (`REDIS_URL`): rate limiting distribuido (INCR+PEXPIRE atómico vía Lua) y adaptador de Socket.IO para multi-instancia. Fallback in-memory si no hay Redis.
- **Pooler transaccional de Supabase** documentado para `DATABASE_URL` en producción (puerto 6543, `pgbouncer=true` + `connection_limit` bajo por instancia); `DIRECT_URL` directo (5432) para migraciones.
- **Analytics `/costs` sin tope de memoria** (`SUM(LENGTH)` en la DB en vez de traer todos los mensajes); **`loadHistory`** corregido (últimos 50, no primeros 50); **chatbot** consulta `getActiveSuperpowers` una sola vez por mensaje (antes hasta 3×); **frontend** pausa el polling de notificaciones con la pestaña oculta.
- Gate `RUN_SCHEDULER`, apagado limpio (SIGTERM/SIGINT), timeout en el http-client.

### 🧩 Integraciones (conectores reales, listos para configurar)
- **Cal.com** (agenda externa): conectar/validar/desconectar + push best-effort de reservas y event types.
- **MercadoPago** (pagos LATAM): Checkout Pro + selector **Stripe/MercadoPago** en Cobros.
- **ManyChat** (canal bidireccional): conector + **webhook entrante** `POST /api/manychat/webhook/:businessId` que pasa el mensaje al mismo cerebro del bot (`processMessage`, canal MESSENGER) y responde en Dynamic Block v2. Endurecido: token solo por header `x-webhook-token` cifrado, rate limit propio por negocio (120/min) y suscriptor (15/min), auth antes de parsear, y continuidad por `subscriberId`.
- **Composio**: conector base (API key cifrada por negocio, validación contra el proveedor, rutas status/connect/disconnect solo ADMIN) + UI en Conexiones.

### 🗄️ Base de datos
- **Migración baseline `0_init`** (adopción no destructiva con `migrate resolve --applied 0_init`) + aditiva `add_two_factor` (solo `ADD COLUMN`).
- **Índices de performance `add_perf_indexes`** (GATED, autorizada): índices compuestos multi-tenant (bookings, conversations, messages, notifications, connections, orders, transactions, users…) y limpieza de redundantes — solo `CREATE/DROP INDEX`. Ver `GATED_MIGRATIONS.md`.
- **Mapeo de errores Prisma `P2021`/`P2022`:** ante un desfase schema↔DB (migración sin aplicar) el handler responde 500 con mensaje claro y lo reporta a Sentry, en vez de un 400 genérico (era la causa del fallo de login por las columnas 2FA sin migrar).
- **Seguridad de concurrencia**: advisory locks + `SELECT ... FOR UPDATE` en reservas, idempotencia de pagos/pedidos, y toda config JSON de fila única con escrituras atómicas.

### ✅ Testing y CI
- ~**1062 tests** (backend ~765 / frontend ~297), cobertura de servicios/rutas con lógica real. Build web (Next 16) y server, tsc y lint en verde.
- Pipeline CI: audit, migrations-check, lint, type-check, test (con Postgres), build.

### 📚 Docs
- `docs/API.md` (endpoints + conectores + webhook de ManyChat), `DEPLOY.md` (deploy, secrets, escalado, checklist de lanzamiento), `CREDENCIALES.md` (qué credencial va dónde) y `GATED_MIGRATIONS.md` (índices + pendientes con dedup).

## Notas de despliegue
- **Migración (una vez por entorno, contra `DIRECT_URL`):** la base ya tiene las tablas (`db push`), así que `migrate deploy` solo falla al aplicar `0_init` con `type "Role" already exists` (P3018/42710). Secuencia correcta: `prisma migrate resolve --applied 0_init` y luego `prisma migrate deploy` (aplica `add_two_factor` + `add_perf_indexes`). Ver `DEPLOY.md`.
- Variables nuevas (opcionales, en `.env.example`): `REDIS_URL`, `ENCRYPTION_KEY`, `RUN_SCHEDULER`, `JWT_EXPIRES_IN`, `TRUST_PROXY_HOPS`, `FRONTEND_URLS`, etc.
- Las credenciales de integraciones se cargan **por negocio** desde el panel de Conexiones, **no** por `.env`. El webhook de ManyChat y Telegram requieren que el backend sea accesible públicamente.
- Pendientes menores anotados: codemod `middleware → proxy` (hoy solo warning), `eslint-config-next → 16` (requiere ESLint 9 / flat config), y 5 vulns de deps del server (prisma/socket.io).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
