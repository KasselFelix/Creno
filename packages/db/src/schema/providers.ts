import { sql } from 'drizzle-orm';
import { boolean, check, index, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './timestamps.js';
import { geographyPoint } from './types.js';
import { users } from './users.js';

export const providerCategory = pgEnum('provider_category', [
  'room',
  'hairdresser',
  'sports_field',
  'photographer',
  'other',
]);

export const providers = pgTable(
  'providers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    category: providerCategory('category').notNull(),
    description: text('description').notNull().default(''),
    address: text('address').notNull(),
    city: text('city').notNull(),
    location: geographyPoint('location').notNull(),
    // Compte Stripe Connect Express. Les deux drapeaux recopient l'état du compte chez Stripe
    // (webhook `account.updated`) : le prestataire encaisse quand `stripe_charges_enabled` est vrai.
    stripeAccountId: text('stripe_account_id').unique(),
    stripeChargesEnabled: boolean('stripe_charges_enabled').notNull().default(false),
    stripeDetailsSubmitted: boolean('stripe_details_submitted').notNull().default(false),
    ...timestamps,
  },
  (t) => [
    index('providers_location_gix').using('gist', t.location),
    // Pas de paiements actifs sans compte Stripe vers lequel verser l'argent.
    check(
      'providers_charges_need_account',
      sql`NOT ${t.stripeChargesEnabled} OR ${t.stripeAccountId} IS NOT NULL`,
    ),
  ],
);
