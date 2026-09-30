// Migre la base de test (creno_test) avant la suite.
import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from '../src/client.js';

export function testDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST manquante (voir .env.example)');
  return url;
}

export default async function setup(): Promise<void> {
  const { db, pool } = createDb(testDatabaseUrl(), { max: 1 });
  try {
    await migrate(db, { migrationsFolder: path.resolve(__dirname, '../migrations') });
  } finally {
    await pool.end();
  }
}
