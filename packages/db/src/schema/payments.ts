import { sql } from 'drizzle-orm';
import {
  char,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { bookings } from './bookings.js';
import { timestamps } from './timestamps.js';

export const paymentStatus = pgEnum('payment_status', ['succeeded', 'refunded']);

// Un paiement reçu pour une réservation. Les lignes ne sont écrites que par le webhook Stripe.
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Une réservation n'a qu'une session Checkout, donc au plus un paiement.
    bookingId: uuid('booking_id')
      .notNull()
      .unique()
      .references(() => bookings.id, { onDelete: 'restrict' }),
    stripePaymentIntentId: text('stripe_payment_intent_id').notNull().unique(),
    amountCents: integer('amount_cents').notNull(),
    // Commission Creno, prélevée sur le montant avant le versement au prestataire.
    feeCents: integer('fee_cents').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    status: paymentStatus('status').notNull().default('succeeded'),
    refundedCents: integer('refunded_cents').notNull().default(0),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    check('payments_amount_cents_positive', sql`${t.amountCents} >= 0`),
    check('payments_fee_cents_range', sql`${t.feeCents} BETWEEN 0 AND ${t.amountCents}`),
    check('payments_refunded_cents_range', sql`${t.refundedCents} BETWEEN 0 AND ${t.amountCents}`),
    check('payments_currency_format', sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
);

// Événements Stripe déjà traités. La clé primaire est l'identifiant de l'événement (`evt_…`) :
// un événement rejoué par Stripe ne peut pas être inséré deux fois, donc pas traité deux fois.
export const stripeEvents = pgTable(
  'stripe_events',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
  },
  // Purge nocturne des vieux événements (job `maintenance.purge-stripe-events`).
  (t) => [index('stripe_events_received_at_idx').on(t.receivedAt)],
);
