# Migraciones de base de datos — Local B

Este proyecto usa **Prisma Migrate** para versionar los cambios del esquema de
PostgreSQL definido en `prisma/schema.prisma`. Hasta ahora el proyecto venía
usando `prisma db push` (sin historial de migraciones); esta carpeta marca el
inicio del uso de migraciones versionadas.

## Requisitos previos

- Tener configurada la variable de entorno `DATABASE_URL` (ver `.env`),
  apuntando a una base PostgreSQL accesible en desarrollo.
- Dependencias instaladas: `npm install` en la raíz del monorepo.

## Crear la migración inicial

Como todavía no existe ninguna migración en esta carpeta, el primer paso es
generar la migración inicial a partir del `schema.prisma` actual:

```bash
npm run db:migrate -- --name init
# equivale a: prisma migrate dev --schema=prisma/schema.prisma --name init
```

Esto va a:

1. Comparar el `schema.prisma` contra el estado de la base de datos.
2. Generar una nueva carpeta `prisma/migrations/<timestamp>_init/migration.sql`
   con el SQL necesario para crear todas las tablas, índices y relaciones.
3. Aplicar esa migración a la base de datos de desarrollo.
4. Regenerar el Prisma Client (`@prisma/client`).
5. Ejecutar el seed automáticamente (configurado en `package.json` bajo la
   clave `"prisma".seed`, que corre `prisma/seed.ts`).

## Flujo de trabajo día a día

Cada vez que se modifique `prisma/schema.prisma` (nuevos modelos, campos,
índices, etc.):

```bash
npm run db:migrate -- --name descripcion_del_cambio
```

Usá nombres descriptivos en minúsculas y con guiones bajos, por ejemplo:
`--name agrega_soft_delete_clientes` o `--name indices_reservas`.

Esto crea una nueva carpeta de migración con el SQL incremental (no vuelve a
generar todo el esquema desde cero) y la aplica localmente.

## Aplicar migraciones en otros entornos

### Otro desarrollador / entorno local nuevo

```bash
npm run db:migrate
```

Prisma detecta las migraciones pendientes en `prisma/migrations/` que todavía
no se aplicaron a esa base y las ejecuta en orden.

### Staging / producción (CI/CD)

En entornos donde no se debe usar el flujo interactivo de `migrate dev`
(que puede resetear la base si detecta drift), se usa:

```bash
npm run db:migrate:deploy
# equivale a: prisma migrate deploy --schema=prisma/schema.prisma
```

`migrate deploy`:

- Solo aplica las migraciones pendientes, en orden.
- No genera migraciones nuevas ni pide confirmación.
- No ejecuta el seed automáticamente (correr `npm run db:seed` aparte si hace
  falta cargar datos de demostración).
- Es seguro de correr en pipelines de CI/CD como paso previo al deploy.

## Regenerar el Prisma Client sin migrar

Si solo cambiaste el schema y necesitás actualizar los tipos de TypeScript
sin tocar la base de datos:

```bash
npm run db:generate
```

## Cargar datos de demostración (seed)

```bash
npm run db:seed
```

Ejecuta `prisma/seed.ts`, que crea un negocio de demostración
(`studio-belleza-demo`) con usuarios, profesionales, horarios, categorías,
servicios, productos, clientes, reservas, pedidos, transacciones y
notificaciones de ejemplo. El seed corre dentro de una única transacción de
Prisma (`prisma.$transaction`) para garantizar que, si algo falla, no quede
data parcial cargada.

Credenciales de acceso del admin de demo:

- Email: `admin@localb.com`
- Contraseña: `admin123`

## Revertir una migración

Prisma Migrate no tiene "down migrations" automáticas. Para revertir un
cambio:

1. Editar `prisma/schema.prisma` para volver al estado anterior.
2. Correr `npm run db:migrate -- --name revierte_<cambio>` para generar una
   nueva migración que deshaga el cambio (por ejemplo, quitar una columna
   agregada por error).

En desarrollo, si la base está en un estado inconsistente y no importa perder
los datos, se puede resetear con:

```bash
npx prisma migrate reset --schema=prisma/schema.prisma
```

**Atención:** esto borra todos los datos de la base de desarrollo, vuelve a
aplicar todas las migraciones desde cero y corre el seed. Nunca usar este
comando contra una base de staging o producción.

## Notas sobre este esquema

- Los campos monetarios (`price`, `totalPrice`, `amount`, `discount`) usan el
  tipo `Decimal` (`@db.Decimal(10, 2)`) en vez de `Float`, para evitar errores
  de redondeo en cálculos financieros. El cliente de Prisma expone estos
  campos como instancias de `Decimal.js`, no como `number` — al serializar a
  JSON conviene convertirlos explícitamente (`.toString()` o `.toNumber()`)
  según corresponda en las rutas de la API.
- Los modelos `User` (clientes), `Service` y `Product` incluyen un campo
  `deletedAt` para borrado lógico (soft delete): en vez de eliminar filas,
  se recomienda setear `deletedAt` con la fecha actual y filtrar por
  `deletedAt: null` en las consultas activas.
- Se agregaron índices (`@@index`) sobre las combinaciones de columnas más
  consultadas (agenda de reservas por negocio/fecha y por profesional/fecha,
  historial de pedidos, bandeja de notificaciones, etc.) para mejorar el
  rendimiento de las consultas más frecuentes de la aplicación.
