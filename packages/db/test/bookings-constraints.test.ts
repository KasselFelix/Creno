import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Database } from '../src/client.js';
import { retryOnDeadlock, sqlState } from '../src/errors.js';
import { bookings, providers, resources, toPoint, toRange, users } from '../src/schema/index.js';
import { testDatabaseUrl } from './global-setup.js';

const { db, pool } = createDb(testDatabaseUrl());
let resourceId: string;
let customerId: string;

const at = (hour: number, minutes = 0) => new Date(Date.UTC(2030, 0, 7, hour, minutes));
const inFifteenMinutes = () => new Date(Date.now() + 15 * 60 * 1000);

function insertBooking(
  database: Database,
  values: {
    start: Date;
    end: Date;
    status: 'pending' | 'confirmed' | 'cancelled' | 'expired';
    expiresAt?: Date | null;
  },
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

async function expectSqlState(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(sqlState(error)).toBe(code);
}

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE sessions, stripe_events, payments, bookings, availability_exceptions, availability_rules, resources, providers, users RESTART IDENTITY CASCADE`,
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
    .values({
      providerId: provider!.id,
      name: 'Studio A',
      timezone: 'Europe/Paris',
      slotMinutes: 60,
      priceCents: 4500,
    })
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
    await expectSqlState(
      insertBooking(db, { start: at(10, 30), end: at(11, 30), status: 'confirmed' }),
      '23P01',
    );
  });

  it('refuse un hold de paiement sur un créneau déjà confirmé', async () => {
    await insertBooking(db, { start: at(10), end: at(11), status: 'confirmed' });
    await expectSqlState(
      insertBooking(db, {
        start: at(10),
        end: at(11),
        status: 'pending',
        expiresAt: inFifteenMinutes(),
      }),
      '23P01',
    );
  });

  it('autorise un chevauchement avec une réservation annulée ou expirée', async () => {
    await insertBooking(db, { start: at(10), end: at(11), status: 'cancelled' });
    await insertBooking(db, { start: at(10), end: at(11), status: 'expired' });
    await expect(
      insertBooking(db, { start: at(10), end: at(11), status: 'confirmed' }),
    ).resolves.toBeDefined();
  });

  it('autorise des créneaux adjacents grâce aux bornes [début, fin)', async () => {
    await insertBooking(db, { start: at(10), end: at(11), status: 'confirmed' });
    await expect(
      insertBooking(db, { start: at(11), end: at(12), status: 'confirmed' }),
    ).resolves.toBeDefined();
  });

  it('refuse un créneau qui n’est pas de la forme [début, fin) (23514)', async () => {
    const insertRaw = (range: string) =>
      db
        .insert(bookings)
        .values({ resourceId, customerId, during: range, status: 'confirmed', priceCents: 4500 });
    await expectSqlState(insertRaw(`(${at(10).toISOString()},${at(11).toISOString()}]`), '23514');
    await expectSqlState(insertRaw(`[${at(10).toISOString()},)`), '23514');
  });

  it('exige expires_at pour une réservation pending (23514)', async () => {
    await expectSqlState(
      insertBooking(db, { start: at(10), end: at(11), status: 'pending' }),
      '23514',
    );
  });

  // Deux connexions distinctes qui insèrent le même créneau en même temps, chacune dans sa transaction.
  async function raceTwoInserts(wrap: <T>(fn: () => Promise<T>) => Promise<T>) {
    const a = createDb(testDatabaseUrl(), { max: 1 });
    const b = createDb(testDatabaseUrl(), { max: 1 });
    try {
      const attempt = (handle: typeof a) =>
        wrap(() =>
          handle.db.transaction(async (tx) => {
            await tx.execute(sql`SELECT pg_sleep(0.05)`);
            await insertBooking(tx as unknown as Database, {
              start: at(10),
              end: at(11),
              status: 'confirmed',
            });
          }),
        );
      const results = await Promise.allSettled([attempt(a), attempt(b)]);
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      return {
        fulfilled: results.length - rejected.length,
        codes: rejected.map((r) => sqlState(r.reason)),
      };
    } finally {
      await Promise.all([a.pool.end(), b.pool.end()]);
    }
  }

  it('documente le comportement brut : une seule insertion passe, le perdant reçoit 23P01 ou un deadlock 40P01', async () => {
    const { fulfilled, codes } = await raceTwoInserts((fn) => fn());
    expect(fulfilled).toBe(1);
    expect(codes).toHaveLength(1);
    expect(['23P01', '40P01']).toContain(codes[0]);
  });

  it('avec retryOnDeadlock, le perdant reçoit toujours 23P01', async () => {
    for (let run = 0; run < 5; run++) {
      await db.execute(sql`DELETE FROM bookings`);
      const { fulfilled, codes } = await raceTwoInserts(retryOnDeadlock);
      expect(fulfilled).toBe(1);
      expect(codes).toEqual(['23P01']);
    }
  });
});
