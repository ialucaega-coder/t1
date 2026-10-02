# Local B — endurecimiento, escalado, integraciones y 2FA

Rama `fix/dev-cors-autoport` → `main`. Trae el proyecto a un estado **feature-complete, CI-green y listo para beta**, con paridad (o mejor) frente a ForjaBots.

## Qué incluye

### 🔐 Seguridad
- **2FA por TOTP** (Google Authenticator/Authy/1Password): setup con QR, verificación, desactivación y segundo factor en el login. Secreto cifrado en reposo (AES-256-GCM, `lib/crypto.ts`).
- Cierre de **IDOR cross-tenant** en el lookup de cliente del chatbot.
- Fix de **fail-open** en la verificación de webhooks de Meta (fail-closed en producción).
- Warning de `META_APP_SECRET`, TTL de sesión configurable, DevSecOps (Dependabot, `npm audit`, CodeQL).
- Rate limiting con lockout de cuenta y auditoría de eventos de auth.

### ⚡ Escalabilidad
- **Redis opt-in** (`REDIS_URL`): rate limiting distribuido (INCR+PEXPIRE atómico vía Lua) y adaptador de Socket.IO para multi-instancia. Fallback in-memory si no hay Redis.
- Gate `RUN_SCHEDULER` para no duplicar jobs al escalar.
- Apagado limpio (SIGTERM/SIGINT) para contenedores.
- Timeout en el http-client del frontend (evita spinners infinitos).

### 🧩 Integraciones (conectores reales, listos para configurar)
- **Cal.com** (agenda): conectar/validar/desconectar + push best-effort de reservas.
- **MercadoPago** (pagos LATAM): Checkout Pro + selector Stripe/MercadoPago en Cobros.
- **ManyChat**: conector base (webhook entrante bidireccional como follow-up).
- Todos con la API key/token cifrada por negocio en `Connection` (sin cambios de schema salvo 2FA).

### 🗄️ Base de datos
- **Migración baseline versionada `0_init`** (adopción no destructiva con `migrate resolve --applied 0_init`).
- Migración aditiva `add_two_factor` (solo `ADD COLUMN`).
- Job de CI que detecta drift entre `schema.prisma` y las migraciones.
- **Seguridad de concurrencia**: advisory locks + `SELECT ... FOR UPDATE` en reservas, idempotencia de pagos, y toda config JSON de fila única (brand, voice, gallery, conversations, integraciones).

### ✅ Testing y CI
- ~**1007 tests** (backend ~716 / frontend ~291), cobertura de servicios/rutas con lógica real.
- Pipeline CI: audit, migrations-check, lint, type-check, test (con Postgres), build.

### 📚 Docs
- `docs/API.md` (referencia de endpoints), `DEPLOY.md` (deploy, secrets, escalado, backups/restore, checklist de lanzamiento).

## Notas de despliegue
- Ejecutar `prisma migrate resolve --applied 0_init` una vez por entorno (la base ya tiene las tablas por `db push`). Ver `DEPLOY.md`.
- Variables nuevas (todas opcionales/documentadas en `.env.example`): `REDIS_URL`, `ENCRYPTION_KEY`, `RUN_SCHEDULER`, `JWT_EXPIRES_IN`, `TRUST_PROXY_HOPS`, `FRONTEND_URLS`, etc.
- Las credenciales de las integraciones (Cal.com, MercadoPago, ManyChat) se cargan por negocio desde el panel de Conexiones.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
