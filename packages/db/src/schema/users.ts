import { sql } from 'drizzle-orm';
import { check, pgEnum, pgTable, text, timestamp, uuid, uniqueIndex } from 'drizzle-orm/pg-core';
import { timestamps } from './timestamps.js';
import { citext } from './types.js';

export const userRole = pgEnum('user_role', ['customer', 'provider', 'admin']);

/** Format E.164, le même que `phoneSchema` (`@creno/shared`). */
export const E164_PATTERN = '^\\+[1-9][0-9]{6,14}$';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: citext('email').notNull().unique(),
    // Un compte n'est créé qu'une fois son adresse confirmée (voir `pending_registrations`) : pas de
    // valeur par défaut, celui qui insère une ligne affirme que l'adresse est prouvée.
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }).notNull(),
    fullName: text('full_name').notNull(),
    // Uniquement un numéro prouvé par un code SMS (voir `phone_verifications`), et à un seul compte :
    // c'est ce qui garantit que les rappels ne partent jamais vers le téléphone d'un tiers.
    phone: text('phone'),
    phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true }),
    role: userRole('role').notNull().default('customer'),
    // Hash argon2id. NULL = compte sans mot de passe (ex. futur OAuth) : connexion par mot de passe impossible.
    passwordHash: text('password_hash'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('users_phone_unique').on(t.phone),
    check('users_phone_verified', sql`(${t.phone} IS NULL) = (${t.phoneVerifiedAt} IS NULL)`),
    check('users_phone_e164', sql`${t.phone} ~ ${sql.raw(`'${E164_PATTERN}'`)}`),
  ],
);
