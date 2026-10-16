import { hash } from '@node-rs/argon2';
import { z } from 'zod';
import {
  createDb,
  DEMO_PASSWORD,
  ensureAppRole,
  migrateAll,
  roleOf,
  seedDemo,
  sqlState,
  users,
} from '@creno/db';

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });

/** Variables du job de migration (à part de celles de l'API, qui ne voit jamais `DATABASE_URL_MIGRATE`). */
export const deployEnvSchema = z.object({
  // Rôle de migration : propriétaire des objets, il crée et fait évoluer les schémas.
  DATABASE_URL_MIGRATE: postgresUrl,
  // Rôle de l'API : utilisateur et mot de passe du rôle applicatif à créer ou mettre à jour.
  DATABASE_URL: postgresUrl,
  DEMO_MODE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  SEED_STRIPE_ACCOUNT_ID: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .string()
      .regex(/^acct_[A-Za-z0-9]+$/, { error: 'identifiant de compte Stripe attendu (acct_…)' })
      .optional(),
  ),
});
export type DeployEnv = z.infer<typeof deployEnvSchema>;

export type DeployLog = (line: Record<string, unknown>) => void;

// Verrou consultatif (tenu par la connexion) : deux jobs lancés en même temps (merges rapprochés)
// s'attendent au lieu de migrer en parallèle.
const MIGRATION_LOCK = "SELECT pg_advisory_lock(hashtext('creno.migrate'))";

/**
 * Prépare la base pour une nouvelle version de l'API, sous le rôle de migration : migrations
 * (métier puis pg-boss), rôle applicatif sans DDL, puis seed de démo sur une base vide. Idempotent.
 */
export async function deployDatabase(env: DeployEnv, log: DeployLog): Promise<void> {
  // Sans limite de durée : le job attend que l'autre ait fini (le timeout du job borne l'attente).
  // keepAlive : la connexion reste inactive pendant la migration ; sans lui, un équipement réseau
  // pourrait la couper en silence, et le verrou avec elle.
  const lockHandle = createDb(env.DATABASE_URL_MIGRATE, {
    max: 1,
    statement_timeout: 0,
    keepAlive: true,
  });
  const lockClient = await lockHandle.pool.connect();
  try {
    await lockClient.query(MIGRATION_LOCK);

    await migrateAll(env.DATABASE_URL_MIGRATE);
    log({ level: 'info', event: 'migrate.schemas_ready' });

    const admin = roleOf(env.DATABASE_URL_MIGRATE);
    const app = roleOf(env.DATABASE_URL);
    const { db, pool } = createDb(env.DATABASE_URL_MIGRATE, { max: 1 });
    try {
      // En local, une seule URL pour tout : pas de rôle à créer.
      if (app.name !== admin.name) {
        await ensureAppRole(db, app);
        log({ level: 'info', event: 'migrate.app_role_ready', role: app.name });
      }

      if (env.DEMO_MODE) {
        const [existing] = await db.select({ id: users.id }).from(users).limit(1);
        if (existing) {
          log({ level: 'info', event: 'migrate.seed_skipped', reason: 'not_empty' });
        } else {
          const summary = await seedDemo(db, {
            passwordHash: await hash(DEMO_PASSWORD),
            stripeAccountId: env.SEED_STRIPE_ACCOUNT_ID ?? null,
            includeAdmin: false,
          });
          log({ level: 'info', event: 'migrate.seeded', ...summary });
        }
      }
    } finally {
      await pool.end();
    }
  } finally {
    lockClient.release();
    await lockHandle.pool.end();
  }
}

/**
 * Résumé loggable d'un échec : le code SQL, jamais le message brut d'une erreur de requête (celle
 * qui crée le rôle contient son mot de passe). Les mots de passe connus sont masqués partout.
 */
export function describeDeployError(error: unknown, secrets: string[]): Record<string, unknown> {
  if (!(error instanceof Error)) return { name: typeof error };
  const code = sqlState(error);
  if (code) return { name: error.name, code };
  let message = error.message;
  for (const secret of secrets.filter(Boolean)) message = message.split(secret).join('[redacted]');
  return { name: error.name, message };
}
