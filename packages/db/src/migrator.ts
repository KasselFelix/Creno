import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { PgBoss } from 'pg-boss';
import { createDb } from './client.js';

/** Applique les migrations en attente (idempotent : journal dans drizzle.__drizzle_migrations). */
export async function migrateDatabase(connectionString: string): Promise<void> {
  // Une migration peut construire un index sur une grosse table : bien plus que les 10 s par défaut.
  const { db, pool } = createDb(connectionString, { max: 1, statement_timeout: 5 * 60_000 });
  try {
    await migrate(db, { migrationsFolder: path.resolve(import.meta.dirname, '../migrations') });
  } finally {
    await pool.end();
  }
}

/** Le schéma de pg-boss se met à jour sur plusieurs secondes au plus (index construits en tâche de fond). */
const JOBS_BACKGROUND_MIGRATION_TIMEOUT_MS = 5 * 60_000;

/**
 * Installe ou met à jour le schéma `pgboss` (file de jobs). L'API démarre pg-boss avec
 * `migrate: false` : elle tourne sous un rôle sans droit de DDL, c'est cette étape (rôle de
 * migration) qui crée et fait évoluer le schéma. pg-boss 12 construit certains index en tâche de
 * fond après sa migration : on attend qu'ils soient finis avant de rendre la main.
 */
export async function installJobsSchema(connectionString: string): Promise<void> {
  const boss = new PgBoss({
    connectionString,
    application_name: 'creno-migrate',
    max: 1,
    migrate: true,
    supervise: false,
    schedule: false,
  });
  // Sans écouteur, un événement `error` arrêterait le processus sans message exploitable.
  let failure: unknown;
  boss.on('error', (error) => {
    failure = error;
  });
  await boss.start();
  try {
    const deadline = Date.now() + JOBS_BACKGROUND_MIGRATION_TIMEOUT_MS;
    for (;;) {
      if (failure) throw failure;
      const status = await boss.getBamStatus();
      // Un échec est retenté par pg-boss : on l'attend comme le reste, jusqu'au délai maximal.
      const outstanding = status
        .filter((row) => row.status !== 'completed')
        .reduce((total, row) => total + row.count, 0);
      if (outstanding === 0) return;
      if (Date.now() > deadline)
        throw new Error('pg-boss : migrations en tâche de fond inachevées');
      await delay(1000);
    }
  } finally {
    await boss.stop({ graceful: false, timeout: 5_000 });
  }
}

/**
 * Toutes les migrations : schéma métier (Drizzle), puis schéma `pgboss`. Un seul chemin partout :
 * `pnpm db:migrate`, setup des tests de l'API, job de migration en production.
 */
export async function migrateAll(connectionString: string): Promise<void> {
  await migrateDatabase(connectionString);
  await installJobsSchema(connectionString);
}
