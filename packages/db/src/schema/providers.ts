import { index, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
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
    stripeAccountId: text('stripe_account_id'),
    ...timestamps,
  },
  (t) => [index('providers_location_gix').using('gist', t.location)],
);
