import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type DbHandle, providers, sqlState, users } from '@creno/db';
import { deployDatabase, describeDeployError } from '../src/cli/deploy-database.js';
import { testDatabaseUrl } from './app.js';

const suffix = randomBytes(4).toString('hex');
const DATABASE = `creno_deploy_${suffix}`;
const APP_ROLE = `creno_app_${suffix}`;
// Mot de passe tiré au hasard : aucun secret en dur dans le dépôt.
const APP_PASSWORD = randomBytes(24).toString('hex');
const STRIPE_ACCOUNT = `acct_seed${suffix}`;

/** URL de la base de test, sur une autre base et éventuellement sous un autre rôle. */
function urlFor(database: string, role?: { name: string; password: string }): string {
  const url = new URL(testDatabaseUrl());
  url.pathname = `/${database}`;
  if (role) {
    url.username = role.name;
    url.password = role.password;
  }
  return url.toString();
}

describe('job de migration (base neuve, rôle applicatif)', () => {
  // Connexion à la base de test, sous le rôle de dev (superutilisateur) : création de la base neuve.
  let server: DbHandle;
  let app: DbHandle;
  const logs: Record<string, unknown>[] = [];
  const adminUrl = () => urlFor(DATABASE);
  const appUrl = () => urlFor(DATABASE, { name: APP_ROLE, password: APP_PASSWORD });
  const run = () =>
    deployDatabase(
      {
        DATABASE_URL_MIGRATE: adminUrl(),
        DATABASE_URL: appUrl(),
        DEMO_MODE: true,
        SEED_STRIPE_ACCOUNT_ID: STRIPE_ACCOUNT,
      },
      (line) => logs.push(line),
    );

  beforeAll(async () => {
    // CREATE/DROP DATABASE forcent un checkpoint : plus que les 10 s par défaut quand la base est chargée.
    server = createDb(testDatabaseUrl(), { max: 1, statement_timeout: 120_000 });
    await server.db.execute(sql.raw(`CREATE DATABASE ${DATABASE}`));
    await run();
    app = createDb(appUrl(), { max: 2 });
  }, 120_000);

  afterAll(async () => {
    await app?.pool.end();
    await server.db.execute(sql.raw(`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`));
    await server.db.execute(sql.raw(`DROP ROLE IF EXISTS ${APP_ROLE}`));
    await server.pool.end();
  }, 150_000);

  it('remplit la démo sans compte admin, avec le compte Stripe de démo', async () => {
    expect(logs.map((line) => line.event)).toEqual([
      'migrate.schemas_ready',
      'migrate.app_role_ready',
      'migrate.seeded',
    ]);
    const roles = await app.db.select({ role: users.role }).from(users);
    expect(roles.length).toBeGreaterThan(0);
    expect(roles.filter((row) => row.role === 'admin')).toEqual([]);
    const [studio] = await app.db
      .select({ stripeAccountId: providers.stripeAccountId })
      .from(providers)
      .where(eq(providers.slug, 'studio-lumiere'));
    expect(studio?.stripeAccountId).toBe(STRIPE_ACCOUNT);
  });

  it('le rôle applicatif lit et écrit, mais ne peut pas créer de table', async () => {
    const [created] = await app.db
      .insert(users)
      .values({
        email: `role.${suffix}@example.com`,
        fullName: 'Rôle',
        passwordHash: 'x',
        emailVerifiedAt: new Date(),
      })
      .returning({ id: users.id });
    await app.db.delete(users).where(eq(users.id, created!.id));

    for (const statement of [
      'CREATE TABLE public.intrus (id int)',
      'CREATE TABLE pgboss.intrus (id int)',
      'CREATE SCHEMA intrus',
    ]) {
      const error = await app.db.execute(sql.raw(statement)).catch((e: unknown) => e);
      expect(sqlState(error)).toBe('42501');
    }
  });

  it('pg-boss tourne sous le rôle applicatif sans migrer : file créée, job envoyé puis reçu', async () => {
    const boss = new PgBoss({
      connectionString: appUrl(),
      max: 1,
      migrate: false,
      supervise: false,
      schedule: false,
    });
    await boss.start();
    try {
      await boss.createQueue('deploy.check');
      const id = await boss.send('deploy.check', { ok: true });
      const [job] = await boss.fetch('deploy.check');
      expect(job?.id).toBe(id);
    } finally {
      await boss.stop({ graceful: false, timeout: 5_000 });
    }
  });

  it('relancé, ne change rien : pas de nouveau seed, droits réappliqués', async () => {
    const before = await app.db.select({ id: users.id }).from(users);
    logs.length = 0;
    await run();
    expect(logs.map((line) => line.event)).toEqual([
      'migrate.schemas_ready',
      'migrate.app_role_ready',
      'migrate.seed_skipped',
    ]);
    expect(await app.db.select({ id: users.id }).from(users)).toHaveLength(before.length);
  }, 60_000);

  it('un échec de requête ne journalise que le code SQL, jamais le mot de passe', () => {
    const queryError = Object.assign(
      new Error(`Failed query: ALTER ROLE x PASSWORD '${APP_PASSWORD}'`),
      {
        cause: Object.assign(new Error('boom'), { code: '42501' }),
      },
    );
    expect(describeDeployError(queryError, [APP_PASSWORD])).toEqual({
      name: 'Error',
      code: '42501',
    });
    expect(
      JSON.stringify(describeDeployError(new Error(`connexion ${APP_PASSWORD}`), [APP_PASSWORD])),
    ).not.toContain(APP_PASSWORD);
  });
});
