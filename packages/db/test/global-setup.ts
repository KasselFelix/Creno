// Migre la base de test (creno_test) avant la suite.
import { migrateDatabase } from '../src/migrator.js';

export function testDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST manquante (voir .env.example)');
  return url;
}

export default async function setup(): Promise<void> {
  await migrateDatabase(testDatabaseUrl());
}
