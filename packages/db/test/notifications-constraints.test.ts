import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/client.js';
import { sqlState } from '../src/errors.js';
import {
  bookings,
  notifications,
  providers,
  resources,
  toPoint,
  toRange,
  users,
} from '../src/schema/index.js';
import { testDatabaseUrl } from './global-setup.js';

const { db, pool } = createDb(testDatabaseUrl());
let providerId: string;
let bookingId: string;
let customerId: string;

async function expectSqlState(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(sqlState(error)).toBe(code);
}

const notification = (overrides: Partial<typeof notifications.$inferInsert> = {}) => ({
  bookingId,
  recipientId: customerId,
  kind: 'booking_confirmed' as const,
  channel: 'email' as const,
  ...overrides,
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE notifications, sessions, stripe_events, payments, bookings, availability_exceptions, availability_rules, resources, providers, users RESTART IDENTITY CASCADE`,
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
  providerId = provider!.id;
  customerId = customer!.id;
  const [resource] = await db
    .insert(resources)
    .values({
      providerId,
      name: 'Studio A',
      timezone: 'Europe/Paris',
      slotMinutes: 60,
      priceCents: 4500,
    })
    .returning({ id: resources.id });
  const [booking] = await db
    .insert(bookings)
    .values({
      resourceId: resource!.id,
      customerId: customer!.id,
      during: toRange(new Date(Date.UTC(2030, 0, 7, 9)), new Date(Date.UTC(2030, 0, 7, 10))),
      status: 'confirmed',
      priceCents: 4500,
    })
    .returning({ id: bookings.id });
  bookingId = booking!.id;
});

afterAll(async () => {
  await pool.end();
});

describe('notifications', () => {
  it('une seule notification par réservation, type, canal et destinataire (23505)', async () => {
    await db.insert(notifications).values(notification());
    await expectSqlState(db.insert(notifications).values(notification()), '23505');
    // Un autre canal ou un autre type restent possibles.
    await db
      .insert(notifications)
      .values(notification({ kind: 'booking_reminder', channel: 'sms' }));
    await db.insert(notifications).values(notification({ kind: 'booking_reminder' }));
  });

  it('un événement rejoué n’insère rien avec ON CONFLICT DO NOTHING', async () => {
    const insert = () =>
      db
        .insert(notifications)
        .values(notification())
        .onConflictDoNothing()
        .returning({ id: notifications.id });
    expect(await insert()).toHaveLength(1);
    expect(await insert()).toHaveLength(0);
  });

  it('`sent` exige une date d’envoi, `failed` et `skipped` un motif (23514)', async () => {
    await expectSqlState(
      db.insert(notifications).values(notification({ status: 'sent' })),
      '23514',
    );
    await expectSqlState(
      db.insert(notifications).values(notification({ status: 'failed' })),
      '23514',
    );
    await expectSqlState(
      db.insert(notifications).values(notification({ status: 'skipped' })),
      '23514',
    );
    await db
      .insert(notifications)
      .values(notification({ status: 'skipped', reason: 'not_configured' }));
  });

  it('refuse un nombre d’essais négatif (23514)', async () => {
    await expectSqlState(db.insert(notifications).values(notification({ attempts: -1 })), '23514');
  });

  it('une réservation notifiée ne peut pas être supprimée (23503)', async () => {
    await db.insert(notifications).values(notification());
    await expectSqlState(db.execute(sql`DELETE FROM bookings`), '23503');
  });
});
