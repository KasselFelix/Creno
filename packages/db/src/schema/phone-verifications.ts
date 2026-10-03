import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { E164_PATTERN, users } from './users.js';

/**
 * Demande de vérification d'un numéro : le numéro visé et le hash du code envoyé par SMS. Le
 * numéro n'arrive dans `users.phone` qu'une fois le code saisi. Seule la demande la plus récente
 * d'un compte est utilisable ; les plus anciennes ne servent qu'à compter les plafonds.
 */
export const phoneVerifications = pgTable(
  'phone_verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    phone: text('phone').notNull(),
    // sha256 de `<id>:<code>`. NULL tant que le SMS n'est pas parti : aucun code ne convient alors.
    codeHash: text('code_hash'),
    // Comptées avant la comparaison : la limite tient même avec des requêtes parallèles.
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Demande la plus récente d'un compte et plafond par compte.
    index('phone_verifications_user_id_created_at_idx').on(t.userId, t.createdAt),
    // Plafond par numéro, tous comptes confondus.
    index('phone_verifications_phone_created_at_idx').on(t.phone, t.createdAt),
    // Purge des demandes expirées.
    index('phone_verifications_expires_at_idx').on(t.expiresAt),
    check('phone_verifications_phone_e164', sql`${t.phone} ~ ${sql.raw(`'${E164_PATTERN}'`)}`),
    check('phone_verifications_attempts_range', sql`${t.attempts} BETWEEN 0 AND 5`),
    check('phone_verifications_expiry_after_creation', sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);
