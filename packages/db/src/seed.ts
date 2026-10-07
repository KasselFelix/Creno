// CLI de développement : `pnpm db:seed` (vide les tables métier puis insère le jeu de démo).
// La démo publique est remplie par le job de migration (apps/api/src/cli/migrate.ts), sans admin.
import { hash } from '@node-rs/argon2';
import { users } from './schema/index.js';
import { createDb } from './client.js';
import { DEMO_PASSWORD, seedDemo } from './demo-seed.js';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL manquante');
  // Le seed vide les tables métier : jamais en production.
  if (process.env.NODE_ENV === 'production') throw new Error('Seed interdit en production');
  const { db, pool } = createDb(url, { max: 1 });

  try {
    // `--if-empty` (démarrage de docker compose) : on ne touche pas à une base qui contient déjà des
    // comptes, sinon chaque redémarrage effacerait les utilisateurs créés et invaliderait leurs sessions.
    if (process.argv.includes('--if-empty')) {
      const [existing] = await db.select({ id: users.id }).from(users).limit(1);
      if (existing) {
        process.stdout.write(
          `${JSON.stringify({ level: 'info', event: 'db.seed_skipped', reason: 'not_empty' })}\n`,
        );
        return;
      }
    }
    const summary = await seedDemo(db, {
      passwordHash: await hash(DEMO_PASSWORD),
      // Compte Stripe Express de test, créé une fois par l'onboarding : le rattacher ici évite de
      // refaire l'onboarding après chaque seed.
      stripeAccountId: process.env.SEED_STRIPE_ACCOUNT_ID?.trim() || null,
      includeAdmin: true,
    });
    process.stdout.write(`${JSON.stringify({ level: 'info', event: 'db.seeded', ...summary })}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({ level: 'error', event: 'db.seed_failed', error: String(error) })}\n`,
  );
  process.exit(1);
});
