import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

/**
 * Une session par appareil connecté. Le refresh token vaut `<id>.<secret>` : seul sha256(secret)
 * est stocké, et il change à chaque refresh (rotation). L'ancien hash reste accepté 10 s
 * (`previous_token_hash`, `rotated_at`) pour les refresh simultanés de plusieurs onglets.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    previousTokenHash: text('previous_token_hash'),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    userAgent: text('user_agent'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('sessions_user_id_idx').on(t.userId),
    // Purge nocturne des sessions expirées (job `maintenance.purge-sessions`).
    index('sessions_expires_at_idx').on(t.expiresAt),
    check('sessions_expiry_after_creation', sql`${t.expiresAt} > ${t.createdAt}`),
    check('sessions_user_agent_length', sql`char_length(${t.userAgent}) <= 200`),
  ],
);
