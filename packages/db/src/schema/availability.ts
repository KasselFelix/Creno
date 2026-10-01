import { sql } from 'drizzle-orm';
import { check, index, pgTable, smallint, text, time, uuid } from 'drizzle-orm/pg-core';
import { resources } from './resources.js';
import { tstzrange } from './types.js';

/**
 * Horaires hebdomadaires, en heure locale du fuseau de la ressource. Une ligne par plage : une
 * pause est le trou entre deux lignes. `end_time` peut valoir 24:00 (fin de journée).
 * Le non-chevauchement des plages d'un même jour (EXCLUDE USING gist) n'est pas exprimable avec
 * Drizzle : il est dans la migration custom `0005_availability_rules_no_overlap.sql`.
 */
export const availabilityRules = pgTable(
  'availability_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    weekday: smallint('weekday').notNull(), // ISO : 1 = lundi … 7 = dimanche
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
  },
  (t) => [
    index('availability_rules_resource_weekday_idx').on(t.resourceId, t.weekday),
    check('availability_rules_weekday_range', sql`${t.weekday} BETWEEN 1 AND 7`),
    check('availability_rules_time_order', sql`${t.startTime} < ${t.endTime}`),
  ],
);

/** Fermetures ponctuelles (congés, maintenance) qui retirent des créneaux. */
export const availabilityExceptions = pgTable(
  'availability_exceptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    during: tstzrange('during').notNull(),
    reason: text('reason'),
  },
  (t) => [
    index('availability_exceptions_resource_during_gix').using('gist', t.resourceId, t.during),
    check(
      'availability_exceptions_during_valid',
      sql`NOT isempty(${t.during}) AND NOT lower_inf(${t.during}) AND NOT upper_inf(${t.during}) AND lower_inc(${t.during}) AND NOT upper_inc(${t.during})`,
    ),
  ],
);
