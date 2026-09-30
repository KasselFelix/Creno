import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Database } from '../src/client.js';
import { bookings, providers, resources, toPoint, toRange, users } from '../src/schema/index.js';
import { testDatabaseUrl } from './global-setup.js';

const { db, pool } = createDb(testDatabaseUrl());
let resourceId: string;
let customerId: string;

const at = (hour: number, minutes = 0) => new Date(Date.UTC(2030, 0, 7, hour, minutes));
const inFifteenMinutes = () => new Date(Date.now() + 15 * 60 * 1000);

function insertBooking(
  database: Database,
  values: { start: Date; end: Date; status: 'pending' | 'confirmed' | 'cancelled' | 'expired'; expiresAt?: Date | null },
) {
  return database.insert(bookings).values({
    resourceId,
    customerId,
    during: toRange(values.start, values.end),
    status: values.status,
    expiresAt: values.expiresAt ?? null,
    priceCents: 4500,
  });
}

/** Code SQLSTATE d'une erreur pg, qu'elle soit brute ou enveloppée par Drizzle (`cause`). */
function sqlState(error: unknown): string | undefined {
  let current: unknown = error;
  while (current && typeof current === 'object') {
    if ('code' in current && typeof current.code === 'string') return current.code;
    current = 'cause' in current ? current.cause : undefined;
  }
  return undefined;
}

async function expectSqlState(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(sqlState(error)).toBe(code);
}

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE bookings, availability_exceptions, availability_rules, resources, providers, users RESTART IDENTITY CASCADE`,
  );
  const [owner, customer] = await db
    .insert(users)
    .values([
      { email: 'owner@test.dev', fullName: 'Owner', role: 'provider' },
      { email: 'client@test.dev', fullName: 'Client' },
    ])
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
  const [resource] = await db
    .insert(resources)
    .values({ providerId: provider!.id, name: 'Studio A', timezone: 'Europe/Paris', slotMinutes: 60, priceCents: 4500 })
    .returning({ id: resources.id });
  resourceId = resource!.id;
  customerId = customer!.id;
});

afterAll(async () => {
  await pool.end();
});

describe('bookings_no_overlap', () => {
  it('refuse deux réservations confirmées qui se chevauchent sur la même ressource (23P01)', async () => {
    await insertBooking(db, { start: at(10), end: at(11), status: 'confirmed' });
    await expectSqlState(insertBooking(db, { start: at(10, 30), end: at(11, 30), status: 'confirmed' }), '23P01');
  });

  it('refuse un hold de paiement sur un créneau déjà confirmé', async () => {
    await insertBooking(db, { start: at(10), end: at(11), status: 'confirmed' });
    await expectSqlState(
      insertBooking(db, { start: at(10), end: at(11), status: 'pending', expiresAt: inFifteenMinutes() }),
      '23P01',
    );
  });

  it('autorise un chevauchement avec une réservation annulée ou expirée', async () => {
    await insertBooking(db, { start: at(10), end: at(11), status: 'cancelled' });
    await insertBooking(db, { start: at(10), end: at(11), status: 'expired' });
    await expect(insertBooking(db, { start: at(10), end: at(11), status: 'confirmed' })).resolves.toBeDefined();
  });

  it('autorise des créneaux adjacents grâce aux bornes [début, fin)', async () => {
    await insertBooking(db, { start: at(10), end: at(11), status: 'confirmed' });
    await expect(insertBooking(db, { start: at(11), end: at(12), status: 'confirmed' })).resolves.toBeDefined();
  });

  it('exige expires_at pour une réservation pending (23514)', async () => {
    await expectSqlState(insertBooking(db, { start: at(10), end: at(11), status: 'pending' }), '23514');
  });

  it('ne laisse passer qu’une réservation sur deux insertions concurrentes', async () => {
    // Deux connexions distinctes qui insèrent en même temps, chacune dans sa transaction.
    const a = createDb(testDatabaseUrl(), { max: 1 });
    const b = createDb(testDatabaseUrl(), { max: 1 });
    try {
      const attempt = (handle: typeof a) =>
        handle.db.transaction(async (tx) => {
          await tx.execute(sql`SELECT pg_sleep(0.05)`);
          await insertBooking(tx as unknown as Database, { start: at(10), end: at(11), status: 'confirmed' });
        });

      const results = await Promise.allSettled([attempt(a), attempt(b)]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect(sqlState(rejected[0]!.reason)).toBe('23P01');
    } finally {
      await Promise.all([a.pool.end(), b.pool.end()]);
    }
  });
});
