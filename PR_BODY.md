# Local B — endurecimiento, escalado, integraciones y 2FA

Rama `fix/dev-cors-autoport` → `main`. Trae el proyecto a un estado **feature-complete, CI-green y listo para beta**, con paridad (o mejor) frente a ForjaBots.

## Qué incluye

### 🔐 Seguridad
- **2FA por TOTP** (Google Authenticator/Authy/1Password): setup con QR, verificación, desactivación y segundo factor en el login. Secreto cifrado en reposo (AES-256-GCM, `lib/crypto.ts`).
- **CRITICAL — ReDoS en el sanitizer (DoS sin auth):** el saneador de inputs usaba regex con backtracking catastrófico (`<script ...>` O(n³), `<a ...>` O(n²)) sobre TODO el body JSON **antes** de autenticar; un POST con miles de `<script`/`<a` sin cerrar bloqueaba el event loop por segundos/minutos. Reemplazado por un stripper de tags lineal O(n) (+ test de regresión con cota de tiempo).
- **CRITICAL — Socket.IO sin autenticar (fuga cross-tenant en tiempo real):** el handshake no validaba nada y `join-business` aceptaba cualquier `businessId`, así que un cliente podía recibir en vivo reservas (con PII) y mensajes de chat de otro negocio. Ahora `io.use()` exige el JWT en el handshake y une el socket **solo** a la room de su negocio (deriva `businessId` del token e ignora el que mande el cliente); el cliente web envía el token en `auth`.
- Cierre de **IDOR cross-tenant** en el lookup de cliente del chatbot.
- Fix de **fail-open** en la verificación de webhooks de Meta (fail-closed en producción) + firma de voz segura por defecto y `verify_token` comparado timing-safe.
- **Guard anti-SSRF** en las URLs de webhook.
- Warning de `META_APP_SECRET`, TTL de sesión configurable (`JWT_EXPIRES_IN`), DevSecOps (Dependabot, `npm audit`, CodeQL).
- Rate limiting con lockout de cuenta y auditoría de eventos de auth.

### ⚡ Escalabilidad
- **Redis opt-in** (`REDIS_URL`): rate limiting distribuido (INCR+PEXPIRE atómico vía Lua) y adaptador de Socket.IO para multi-instancia. Fallback in-memory si no hay Redis.
- **Pooler transaccional de Supabase** documentado para `DATABASE_URL` en producción (puerto 6543, `pgbouncer=true` + `connection_limit` bajo por instancia para no agotar `max_connections` al sumar réplicas); `DIRECT_URL` queda directo (5432) para migraciones.
- **Analytics `/costs` sin tope de memoria:** suma el largo de los textos **en la DB** (`SUM(LENGTH)` vía `$queryRaw`) en vez de traer todos los mensajes del bot a memoria (antes crecía O(mensajes) con el volumen del negocio).
- **`loadHistory` del chatbot corregido:** trae los **últimos** 50 mensajes (desc+take+reverse) para darle a la IA el contexto reciente, no los primeros 50 de la charla.
- Tope diario de mensajes con imágenes por negocio (guarda de costo), paginación, caché TTL en stats y anti-N+1.
- Gate `RUN_SCHEDULER` para no duplicar jobs al escalar.
- Apagado limpio (SIGTERM/SIGINT) para contenedores.
- Timeout en el http-client del frontend (evita spinners infinitos).

### 🧩 Integraciones (conectores reales, listos para configurar)
- **Cal.com** (agenda externa): conectar/validar/desconectar + push best-effort de reservas y event types.
- **MercadoPago** (pagos LATAM): Checkout Pro + selector **Stripe/MercadoPago** en Cobros.
- **ManyChat** (canal bidireccional): además del conector, **webhook entrante** `POST /api/manychat/webhook/:businessId` que pasa el mensaje al mismo cerebro del bot (`processMessage`, canal MESSENGER) y responde en formato Dynamic Block v2. Endurecido: token **solo por header** `x-webhook-token` y **cifrado en reposo**, rate limit propio por negocio (120/min) y suscriptor (15/min) fuera del límite global por IP, autenticación antes de parsear el body, y continuidad de conversación por `subscriberId` (reusa la charla OPEN, sin cambios de schema). Token rotable desde el panel.
- **Composio**: conector base (API key cifrada por negocio, validación contra el proveedor, rutas status/connect/disconnect solo ADMIN) + UI en Conexiones.
- Todas las credenciales van **cifradas por negocio** en `Connection` (AES-256-GCM), sin cambios de schema salvo 2FA.

### 🗄️ Base de datos
- **Migración baseline versionada `0_init`** (adopción no destructiva con `migrate resolve --applied 0_init`).
- Migración aditiva `add_two_factor` (solo `ADD COLUMN`).
- **Mapeo de errores Prisma `P2021`/`P2022`:** ante un desfase schema↔DB (una migración sin aplicar) el handler responde 500 con mensaje claro ("falta aplicar una migración") y lo reporta a Sentry, en vez de enmascararlo como un 400 genérico (era la causa del fallo de login por las columnas 2FA sin migrar).
- Job de CI que detecta drift entre `schema.prisma` y las migraciones.
- **Seguridad de concurrencia**: advisory locks + `SELECT ... FOR UPDATE` en reservas, idempotencia de pagos/pedidos (`Idempotency-Key`), y toda config JSON de fila única (brand, voice, gallery, conversations, integraciones) con escrituras atómicas.

### ✅ Testing y CI
- ~**1007 tests** (backend ~716 / frontend ~291), cobertura de servicios/rutas con lógica real.
- Pipeline CI: audit, migrations-check, lint, type-check, test (con Postgres), build.

### 📚 Docs
- `docs/API.md` (referencia de endpoints, incl. conectores de integración y webhook de ManyChat), `DEPLOY.md` (deploy, secrets, escalado, backups/restore, checklist de lanzamiento) y `CREDENCIALES.md` (qué credencial va dónde).

## Notas de despliegue
- **Migración (una vez por entorno, la corre el usuario contra `DIRECT_URL`):** la base ya tiene las tablas (se construyó con `db push`), así que `migrate deploy` **solo** falla al aplicar la baseline `0_init` con `type "Role" already exists` (P3018/42710). Secuencia correcta: `prisma migrate resolve --applied 0_init` (marca la baseline sin correr su SQL) y luego `prisma migrate deploy` (aplica `add_two_factor` y futuras). Ver `DEPLOY.md` → Checklist de lanzamiento y §3.
- Variables nuevas (todas opcionales/documentadas en `.env.example`): `REDIS_URL`, `ENCRYPTION_KEY`, `RUN_SCHEDULER`, `JWT_EXPIRES_IN`, `TRUST_PROXY_HOPS`, `FRONTEND_URLS`, etc.
- Las credenciales de las integraciones (Cal.com, MercadoPago, ManyChat, Composio) se cargan **por negocio** desde el panel de Conexiones, **no** por `.env`. El webhook entrante de ManyChat requiere que el backend sea accesible públicamente.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
