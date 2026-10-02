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
import { resources } from './resources.js';
import { timestamps } from './timestamps.js';
import { tstzrange } from './types.js';
import { users } from './users.js';

export const bookingStatus = pgEnum('booking_status', [
  'pending',
  'confirmed',
  'cancelled',
  'expired',
]);

// La contrainte anti double réservation (EXCLUDE USING gist) n'est pas exprimable avec Drizzle :
// elle est dans la migration custom `0002_bookings_no_overlap.sql`.
export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'restrict' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    during: tstzrange('during').notNull(),
    status: bookingStatus('status').notNull().default('pending'),
    // Fin du hold de paiement (15 min, puis 31 min une fois le paiement lancé) ; obligatoire tant
    // que le statut est `pending`.
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    priceCents: integer('price_cents').notNull(),
    currency: char('currency', { length: 3 }).notNull().default('EUR'),
    // Renseigné au premier lancement du paiement : le hold n'est prolongé qu'une fois. Un hold
    // expiré sans cette date n'a jamais atteint le paiement (panier abandonné avant Stripe).
    checkoutStartedAt: timestamp('checkout_started_at', { withTimezone: true }),
    stripeCheckoutSessionId: text('stripe_checkout_session_id').unique(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('bookings_customer_id_idx').on(t.customerId),
    // Holds à expirer (job `maintenance.expire-holds`) : seules les lignes `pending` sont indexées.
    index('bookings_pending_expires_at_idx')
      .on(t.expiresAt)
      .where(sql`${t.status} = 'pending'`),
    // L'index de l'EXCLUDE est partiel (pending/confirmed) : celui-ci couvre la clé étrangère et
    // les requêtes par ressource sur tous les statuts (historique, dashboard, occupation).
    index('bookings_resource_id_during_gix').using('gist', t.resourceId, t.during),
    check('bookings_currency_format', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    // Créneau non vide, borné, et toujours [début, fin) : 10h-11h et 11h-12h ne se chevauchent pas.
    check(
      'bookings_during_valid',
      sql`NOT isempty(${t.during}) AND NOT lower_inf(${t.during}) AND NOT upper_inf(${t.during}) AND lower_inc(${t.during}) AND NOT upper_inc(${t.during})`,
    ),
    check(
      'bookings_pending_has_expiry',
      sql`${t.status} <> 'pending' OR ${t.expiresAt} IS NOT NULL`,
    ),
    check('bookings_price_cents_positive', sql`${t.priceCents} >= 0`),
    check(
      'bookings_cancelled_has_date',
      sql`${t.status} <> 'cancelled' OR ${t.cancelledAt} IS NOT NULL`,
    ),
  ],
);
