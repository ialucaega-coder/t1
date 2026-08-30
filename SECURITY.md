# Seguridad — Local B

Este documento describe la arquitectura de seguridad de la plataforma
SaaS Local B, el flujo de autenticación, las medidas de protección de
datos implementadas y cómo reportar vulnerabilidades.

## 1. Arquitectura de seguridad

Local B es un monorepo con dos aplicaciones principales:

- `apps/server` — API REST en Express.js (Node.js + TypeScript)
- `apps/web` — Frontend en Next.js 14 (App Router)
- `prisma/schema.prisma` — Esquema de base de datos (PostgreSQL vía Prisma)

### 1.1 Capas de defensa en el backend (`apps/server`)

| Capa | Middleware / mecanismo | Ubicación |
|---|---|---|
| Cabeceras HTTP base | Helmet (CSP, HSTS, etc.) | `src/index.ts` |
| Cabeceras HTTP adicionales | `extraSecurityHeaders` (Permissions-Policy, Cross-Origin-*, Cache-Control, X-Content-Type-Options, Referrer-Policy) | `src/middleware/security.ts` |
| CORS | Restringido a `FRONTEND_URL`, con `credentials: true` | `src/index.ts` |
| Límite de tamaño de peticiones | `validateRequestSize` + límite de `express.json` | `src/middleware/security.ts`, `src/index.ts` |
| Saneamiento de entradas (anti-XSS) | `sanitizeRequest` (elimina `<script>`, handlers `on*=`, `javascript:`, etc.) | `src/middleware/security.ts` |
| Validación de esquema | Zod (`validate`, `validateQuery`) | `src/middleware/validate.ts`, `src/validators/*` |
| CSRF | Patrón "double submit cookie" (`issueCsrfToken`, `csrfProtection`) | `src/middleware/security.ts` |
| Rate limiting | 100 req/15min general, 10 req/15min en `/api/auth/*` | `src/middleware/rateLimit.ts` |
| Autenticación | JWT firmado (HS256), expiración de 14 días | `src/middleware/auth.ts`, `src/routes/auth.ts` |
| Autorización | Control de acceso por rol (`ADMIN`, `PROFESSIONAL`, `CLIENT`) y por `businessId` (multi-tenant) | `src/middleware/auth.ts` |
| Hashing de contraseñas | bcrypt, 12 rounds | `src/routes/auth.ts` |
| Bloqueo de cuenta | 5 intentos fallidos → bloqueo de 15 minutos | `src/routes/auth.ts` |
| Auditoría | Registro de eventos de auth, mutaciones de datos y violaciones de rate limit | `src/middleware/audit.ts` |
| Manejo centralizado de errores | Respuestas consistentes, sin fuga de stack traces | `src/middleware/errorHandler.ts` |

### 1.2 Capas de defensa en el frontend (`apps/web`)

- **Next.js Middleware** (`src/middleware.ts`): protege las rutas del
  panel privado (`/dashboard`, `/clientes`, `/productos`, etc.),
  redirige a `/login` a usuarios no autenticados, redirige a usuarios
  ya autenticados fuera de `/login` y `/register`, y agrega cabeceras
  de seguridad a cada respuesta.
- **Contexto de autenticación** (`src/lib/auth-context.tsx`): gestiona
  el estado de sesión en el cliente.
- El token JWT se almacena en `localStorage` para las llamadas a la
  API (`Authorization: Bearer <token>`) y se refleja en una cookie no
  sensible (`auth_token`) únicamente para que el middleware de Next.js
  pueda decidir si redirige o no. Esa cookie **no es una fuente de
  verdad de seguridad**: la validación real de la sesión ocurre
  siempre en el backend mediante verificación de la firma del JWT.

## 2. Flujo de autenticación

1. **Registro** (`POST /api/auth/register`): el email se normaliza
   (trim + minúsculas), la contraseña se valida (mínimo 8 caracteres,
   con mayúscula, minúscula y número) y se hashea con bcrypt (12
   rounds) antes de persistirse. Se crea el negocio (`Business`) y el
   usuario administrador en una misma transacción de Prisma.
2. **Login** (`POST /api/auth/login`): se valida el email/contraseña
   contra la base de datos. Si la cuenta está bloqueada
   (`lockedUntil` en el futuro), se responde `423 Locked` sin
   intentar comparar la contraseña. Si la contraseña es incorrecta,
   se incrementa `failedLogins`; al llegar a 5 intentos fallidos se
   fija `lockedUntil = now + 15min`. Un login exitoso resetea el
   contador y actualiza `lastLoginAt`.
3. **Emisión del token**: se firma un JWT (`NEXTAUTH_SECRET`, HS256)
   con `userId`, `businessId` y `role`, expiración de 14 días. Se
   devuelve en el cuerpo de la respuesta y también se setea como
   cookie `httpOnly`, `Secure` (en producción) y `SameSite=Strict`
   (`session_token`) como defensa adicional.
4. **Peticiones autenticadas**: el middleware `requireAuth` valida la
   firma y expiración del JWT en cada request protegido, y adjunta
   `req.auth = { userId, businessId, role }`.
5. **Autorización por rol/negocio**: `requireRole(...)` restringe
   endpoints según el rol del usuario; las consultas a la base de
   datos siempre filtran por `businessId` para garantizar el
   aislamiento entre negocios (multi-tenant).
6. **Logout** (`POST /api/auth/logout`): limpia la cookie de sesión.
   El cliente también debe eliminar el token de `localStorage`.

### Variables de entorno relevantes

- `NEXTAUTH_SECRET`: secreto usado para firmar los JWT. **Obligatorio
  en producción** — el servidor rehúsa arrancar si no está definido o
  si coincide con el valor de desarrollo (`dev-secret`).
- `FRONTEND_URL`: origen permitido por CORS.
- `NODE_ENV`: controla si las cookies se marcan como `Secure` y si se
  registran logs de auditoría en formato JSON estructurado.

## 3. Protección de datos

- **Contraseñas**: nunca se almacenan en texto plano; se usa bcrypt
  con 12 rounds. Nunca se registran en logs de auditoría.
- **Aislamiento multi-tenant**: cada registro relevante (`User`,
  `Booking`, `Client`, etc.) pertenece a un `businessId`; todas las
  consultas del backend deben filtrar por el negocio del usuario
  autenticado.
- **Borrado lógico**: entidades sensibles como `User` usan
  `deletedAt` (soft delete) en lugar de eliminación física, para
  preservar el historial y permitir auditorías.
- **Saneamiento de entradas**: todo `body` y `query` pasa por
  `sanitizeRequest` antes de llegar a los validadores de Zod,
  reduciendo el riesgo de XSS almacenado.
- **Límites de tamaño**: las peticiones están limitadas a 5 MB y las
  URLs a 2048 caracteres para mitigar ataques de denegación de
  servicio por payloads gigantes.
- **Cabeceras de seguridad**: CSP restrictiva, `X-Content-Type-Options:
  nosniff`, `X-Frame-Options: DENY` (frontend), `Permissions-Policy`
  restringiendo APIs sensibles del navegador, y `Cross-Origin-*`
  policies para evitar embebido cross-origin no autorizado.
- **Auditoría**: los eventos de autenticación, las mutaciones de
  datos (`create`/`update`/`delete`) y las violaciones de rate
  limiting se registran con timestamp, tipo de evento, recurso, IP y
  usuario/negocio involucrados (nunca se registran contraseñas ni
  tokens).

## 4. Reportar una vulnerabilidad

Si encontrás una vulnerabilidad de seguridad en Local B, por favor
**no la reportes en un issue público**. Escribinos directamente a:

**security@localb.app**

Incluí en tu reporte:

- Una descripción clara de la vulnerabilidad y su impacto potencial.
- Pasos para reproducirla (idealmente con una prueba de concepto).
- Versión/commit afectado, si lo conocés.

Nos comprometemos a:

- Confirmar la recepción del reporte dentro de las 48 horas hábiles.
- Mantener comunicación sobre el progreso de la investigación y
  la corrección.
- Acreditar públicamente a quien reportó el problema (si así lo
  desea) una vez resuelto.

Pedimos divulgación responsable: por favor, dennos un tiempo
razonable para corregir el problema antes de hacerlo público.
