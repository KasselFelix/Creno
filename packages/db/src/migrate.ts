// CLI : `pnpm db:migrate` (dev, via tsx) ou `node dist/migrate.js` (production).
import { migrateDatabase } from './migrator.js';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL manquante');
  await migrateDatabase(url);
  process.stdout.write(`${JSON.stringify({ level: 'info', event: 'db.migrated' })}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({ level: 'error', event: 'db.migrate_failed', error: String(error) })}\n`,
  );
  process.exit(1);
});
