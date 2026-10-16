import { migrateAll } from '@creno/db';

/**
 * Migre la base de test avant la suite (les tests d'intégration utilisent une vraie base), par le même
 * chemin que la production : schéma métier puis schéma `pgboss` (l'API démarre pg-boss sans migrer).
 */
export default async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST manquante (voir .env.example)');
  await migrateAll(url);
}
