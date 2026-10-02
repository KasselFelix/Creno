import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/client.js';
import { sqlState } from '../src/errors.js';
import { pendingRegistrations, users } from '../src/schema/index.js';
import { testDatabaseUrl } from './global-setup.js';

const { db, pool } = createDb(testDatabaseUrl());

const DAY_MS = 24 * 60 * 60_000;

const attempt = (patch: Partial<typeof pendingRegistrations.$inferInsert> = {}) =>
  db.insert(pendingRegistrations).values({
    email: 'lea@test.dev',
    expiresAt: new Date(Date.now() + DAY_MS),
    ...patch,
  });

async function expectSqlState(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(sqlState(error)).toBe(code);
}

beforeEach(async () => {
  await db.execute(sql`TRUNCATE pending_registrations, users RESTART IDENTITY CASCADE`);
});

afterAll(async () => {
  await pool.end();
});

describe('pending_registrations', () => {
  it('accepte plusieurs demandes pour la même adresse, casse différente comprise', async () => {
    await attempt();
    await expect(attempt({ email: 'LEA@test.dev' })).resolves.toBeDefined();
    const rows = await db
      .select({ id: pendingRegistrations.id })
      .from(pendingRegistrations)
      .where(sql`${pendingRegistrations.email} = 'lea@TEST.dev'`);
    expect(rows).toHaveLength(2);
  });

  it('refuse une échéance antérieure à la création (23514)', async () => {
    await expectSqlState(attempt({ expiresAt: new Date(Date.now() - DAY_MS) }), '23514');
  });
});

describe('users.email_verified_at', () => {
  it('est obligatoire : un compte sans adresse confirmée ne peut pas exister (23502)', async () => {
    await expectSqlState(
      db.execute(sql`INSERT INTO users (email, full_name) VALUES ('lea@test.dev', 'Léa')`),
      '23502',
    );
    await expect(
      db
        .insert(users)
        .values({ email: 'lea@test.dev', fullName: 'Léa', emailVerifiedAt: new Date() }),
    ).resolves.toBeDefined();
  });
});
