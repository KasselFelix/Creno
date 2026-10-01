import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client.js';

/** Applique les migrations en attente (idempotent : journal dans drizzle.__drizzle_migrations). */
export async function migrateDatabase(connectionString: string): Promise<void> {
  const { db, pool } = createDb(connectionString, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: path.resolve(import.meta.dirname, '../migrations') });
  } finally {
    await pool.end();
  }
}
