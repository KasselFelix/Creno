// Applique les migrations en attente (idempotent : Drizzle tient un journal dans drizzle.__drizzle_migrations).
import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client.js';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL manquante');

  const { db, pool } = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: path.resolve(__dirname, '../migrations') });
    process.stdout.write(`${JSON.stringify({ level: 'info', event: 'db.migrated' })}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({ level: 'error', event: 'db.migrate_failed', error: String(error) })}\n`);
  process.exit(1);
});
