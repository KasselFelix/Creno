import { pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './timestamps.js';
import { citext } from './types.js';

export const userRole = pgEnum('user_role', ['customer', 'provider', 'admin']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: citext('email').notNull().unique(),
  // Un compte n'est créé qu'une fois son adresse confirmée (voir `pending_registrations`) : pas de
  // valeur par défaut, celui qui insère une ligne affirme que l'adresse est prouvée.
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }).notNull(),
  fullName: text('full_name').notNull(),
  phone: text('phone'),
  role: userRole('role').notNull().default('customer'),
  // Hash argon2id. NULL = compte sans mot de passe (ex. futur OAuth) : connexion par mot de passe impossible.
  passwordHash: text('password_hash'),
  ...timestamps,
});
