import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/client.js';
import { sqlState } from '../src/errors.js';
import {
  bookings,
  payments,
  providers,
  resources,
  stripeEvents,
  toPoint,
  toRange,
  users,
} from '../src/schema/index.js';
import { testDatabaseUrl } from './global-setup.js';

const { db, pool } = createDb(testDatabaseUrl());
let providerId: string;
let bookingId: string;

async function expectSqlState(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(sqlState(error)).toBe(code);
}

const payment = (overrides: Partial<typeof payments.$inferInsert> = {}) => ({
  bookingId,
  stripePaymentIntentId: 'pi_test_1',
  amountCents: 4500,
  feeCents: 450,
  currency: 'EUR',
  ...overrides,
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE notifications, sessions, stripe_events, payments, bookings, availability_exceptions, availability_rules, resources, providers, users RESTART IDENTITY CASCADE`,
  );
  const [owner, customer] = await db
    .insert(users)
    .values([
      { email: 'owner@test.dev', fullName: 'Owner', role: 'provider', emailVerifiedAt: new Date() },
      { email: 'client@test.dev', fullName: 'Client', emailVerifiedAt: new Date() },
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

describe('payments', () => {
  it('un seul paiement par réservation et par PaymentIntent (23505)', async () => {
    await db.insert(payments).values(payment());
    await expectSqlState(
      db.insert(payments).values(payment({ stripePaymentIntentId: 'pi_test_2' })),
      '23505',
    );
  });

  it('refuse une commission ou un remboursement supérieurs au montant (23514)', async () => {
    await expectSqlState(db.insert(payments).values(payment({ feeCents: 4501 })), '23514');
    await expectSqlState(db.insert(payments).values(payment({ refundedCents: 4501 })), '23514');
    await expectSqlState(db.insert(payments).values(payment({ amountCents: -1 })), '23514');
  });
});

describe('stripe_events', () => {
  it('un événement rejoué n’est pas inséré une seconde fois', async () => {
    const insert = () =>
      db
        .insert(stripeEvents)
        .values({ id: 'evt_test_1', type: 'checkout.session.completed' })
        .onConflictDoNothing()
        .returning({ id: stripeEvents.id });
    expect(await insert()).toHaveLength(1);
    expect(await insert()).toHaveLength(0);
  });
});

describe('providers (compte Stripe)', () => {
  it('refuse des paiements actifs sans compte Stripe (23514)', async () => {
    await expectSqlState(
      db.update(providers).set({ stripeChargesEnabled: true }).where(eq(providers.id, providerId)),
      '23514',
    );
    await db
      .update(providers)
      .set({ stripeAccountId: 'acct_test_1', stripeChargesEnabled: true })
      .where(eq(providers.id, providerId));
  });
});
