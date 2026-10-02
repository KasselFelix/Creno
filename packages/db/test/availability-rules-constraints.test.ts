import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/client.js';
import { sqlState } from '../src/errors.js';
import { availabilityRules, providers, resources, toPoint, users } from '../src/schema/index.js';
import { testDatabaseUrl } from './global-setup.js';

const { db, pool } = createDb(testDatabaseUrl());
let resourceIds: string[];

const rule = (resourceId: string, weekday: number, startTime: string, endTime: string) =>
  db.insert(availabilityRules).values({ resourceId, weekday, startTime, endTime });

async function expectSqlState(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(sqlState(error)).toBe(code);
}

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE notifications, sessions, stripe_events, payments, bookings, availability_exceptions, availability_rules, resources, providers, users RESTART IDENTITY CASCADE`,
  );
  const [owner] = await db
    .insert(users)
    .values({ email: 'owner@test.dev', fullName: 'Owner', role: 'provider' })
    .returning({ id: users.id });
  const [provider] = await db
    .insert(providers)
    .values({
      userId: owner!.id,
      name: 'Studio',
      slug: 'studio',
      category: 'photographer',
      address: '1 rue du Test',
      city: 'Paris',
      location: toPoint(2.35, 48.85),
    })
    .returning({ id: providers.id });
  const rows = await db
    .insert(resources)
    .values(
      ['Studio A', 'Studio B'].map((name) => ({
        providerId: provider!.id,
        name,
        timezone: 'Europe/Paris',
        slotMinutes: 60,
        priceCents: 4500,
      })),
    )
    .returning({ id: resources.id });
  resourceIds = rows.map((r) => r.id);
});

afterAll(async () => {
  await pool.end();
});

describe('availability_rules_no_overlap', () => {
  it('refuse deux plages qui se chevauchent le même jour pour la même ressource (23P01)', async () => {
    await rule(resourceIds[0]!, 1, '09:00', '12:00');
    await expectSqlState(rule(resourceIds[0]!, 1, '11:00', '14:00'), '23P01');
    await expectSqlState(rule(resourceIds[0]!, 1, '09:00', '12:00'), '23P01');
  });

  it('autorise des plages qui se touchent, un autre jour ou une autre ressource', async () => {
    await rule(resourceIds[0]!, 1, '09:00', '12:00');
    await expect(rule(resourceIds[0]!, 1, '12:00', '14:00')).resolves.toBeDefined();
    await expect(rule(resourceIds[0]!, 2, '09:00', '12:00')).resolves.toBeDefined();
    await expect(rule(resourceIds[1]!, 1, '09:00', '12:00')).resolves.toBeDefined();
  });

  it('accepte une fin à 24:00 et refuse une plage vide ou inversée (23514)', async () => {
    await expect(rule(resourceIds[0]!, 7, '18:00', '24:00')).resolves.toBeDefined();
    await expectSqlState(rule(resourceIds[0]!, 6, '12:00', '12:00'), '23514');
    await expectSqlState(rule(resourceIds[0]!, 6, '14:00', '12:00'), '23514');
  });
});
