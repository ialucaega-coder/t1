/**
 * Backfill único: cifra en reposo las credenciales de terceros que quedaron en
 * TEXTO PLANO en Connection.config antes de activarse el cifrado (H3). La app
 * ya re-cifra perezosamente al re-guardar; este script migra los datos EXISTENTES
 * de una sola vez para que un dump de DB no exponga credenciales.
 *
 * Es IDEMPOTENTE: solo cifra valores que todavía NO están cifrados (isEncrypted),
 * así que correrlo dos veces no hace daño. Por defecto es DRY-RUN (no escribe);
 * pasá --apply para persistir. NUNCA imprime el valor de ninguna credencial.
 *
 * Cubre: AI_ENGINE (config.keys[*]), ai_provider (config.apiKey),
 * INSTAGRAM/MESSENGER (config.pageAccessToken), webhook (config.secret).
 * NO cubre TELEGRAM: migrar su botToken requiere además regenerar el webhook
 * con secret_token, así que esas conexiones se migran al reconectarlas.
 *
 * Uso (desde apps/server, con el .env cargado):
 *   npx tsx scripts/backfill-encrypt-credentials.ts           # dry-run
 *   npx tsx scripts/backfill-encrypt-credentials.ts --apply   # aplica
 */
import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { encrypt, isEncrypted } from '../src/lib/crypto';

const APPLY = process.argv.includes('--apply');

type Cfg = Record<string, unknown>;

/** Cifra `value` si es un string no vacío y todavía no está cifrado. Devuelve
 * el nuevo valor y si cambió. */
function maybeEncrypt(value: unknown): { next: unknown; changed: boolean } {
  if (typeof value !== 'string' || value === '' || isEncrypted(value)) {
    return { next: value, changed: false };
  }
  return { next: encrypt(value), changed: true };
}

async function run() {
  console.log(`Backfill de cifrado de credenciales — modo ${APPLY ? 'APPLY (escribe)' : 'DRY-RUN (no escribe)'}`);

  const connections = await prisma.connection.findMany({
    where: { type: { in: ['AI_ENGINE', 'ai_provider', 'INSTAGRAM', 'MESSENGER', 'webhook'] } },
    select: { id: true, type: true, config: true },
  });

  let scanned = 0;
  let toMigrate = 0;
  const byType: Record<string, number> = {};

  for (const conn of connections) {
    scanned++;
    const cfg = (conn.config && typeof conn.config === 'object' && !Array.isArray(conn.config))
      ? ({ ...(conn.config as Cfg) })
      : null;
    if (!cfg) continue;

    let changed = false;

    if (conn.type === 'AI_ENGINE') {
      const keys = cfg.keys && typeof cfg.keys === 'object' && !Array.isArray(cfg.keys)
        ? ({ ...(cfg.keys as Cfg) })
        : null;
      if (keys) {
        for (const k of Object.keys(keys)) {
          const r = maybeEncrypt(keys[k]);
          if (r.changed) { keys[k] = r.next; changed = true; }
        }
        if (changed) cfg.keys = keys;
      }
    } else if (conn.type === 'ai_provider') {
      const r = maybeEncrypt(cfg.apiKey);
      if (r.changed) { cfg.apiKey = r.next; changed = true; }
    } else if (conn.type === 'INSTAGRAM' || conn.type === 'MESSENGER') {
      const r = maybeEncrypt(cfg.pageAccessToken);
      if (r.changed) { cfg.pageAccessToken = r.next; changed = true; }
    } else if (conn.type === 'webhook') {
      const r = maybeEncrypt(cfg.secret);
      if (r.changed) { cfg.secret = r.next; changed = true; }
    }

    if (changed) {
      toMigrate++;
      byType[conn.type] = (byType[conn.type] ?? 0) + 1;
      if (APPLY) {
        await prisma.connection.update({ where: { id: conn.id }, data: { config: cfg as object } });
      }
    }
  }

  console.log(`Conexiones escaneadas: ${scanned}`);
  console.log(`Con credenciales en texto plano a cifrar: ${toMigrate}`, byType);
  console.log(APPLY ? 'Listo: credenciales cifradas.' : 'DRY-RUN: no se escribió nada. Volvé a correr con --apply para aplicar.');
  console.log('Nota: las conexiones de Telegram NO se migran acá (requieren reconectar para regenerar el secret_token del webhook).');
}

run()
  .catch((err) => {
    console.error('Error en el backfill:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
