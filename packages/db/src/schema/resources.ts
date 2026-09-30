import { sql } from 'drizzle-orm';
import { boolean, char, check, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { providers } from './providers.js';
import { timestamps } from './timestamps.js';

export const resources = pgTable(
  'resources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    // Fuseau IANA (ex. Europe/Paris) : les règles hebdomadaires sont exprimées dans ce fuseau.
    timezone: text('timezone').notNull(),
    slotMinutes: integer('slot_minutes').notNull(),
    priceCents: integer('price_cents').notNull(),
    currency: char('currency', { length: 3 }).notNull().default('EUR'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index('resources_provider_id_idx').on(t.providerId),
    check('resources_slot_minutes_range', sql`${t.slotMinutes} BETWEEN 5 AND 1440`),
    check('resources_price_cents_positive', sql`${t.priceCents} >= 0`),
    check('resources_currency_format', sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
);
