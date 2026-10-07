// CLI de développement : `pnpm db:migrate` (via tsx). Schéma métier puis schéma `pgboss`.
// En production, c'est le job de migration (apps/api/src/cli/migrate.ts) qui s'en charge.
import { migrateAll } from './migrator.js';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL manquante');
  await migrateAll(url);
  process.stdout.write(`${JSON.stringify({ level: 'info', event: 'db.migrated' })}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({ level: 'error', event: 'db.migrate_failed', error: String(error) })}\n`,
  );
  process.exit(1);
});
