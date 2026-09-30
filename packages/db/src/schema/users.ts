import { pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './timestamps.js';
import { citext } from './types.js';

export const userRole = pgEnum('user_role', ['customer', 'provider', 'admin']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: citext('email').notNull().unique(),
  fullName: text('full_name').notNull(),
  phone: text('phone'),
  role: userRole('role').notNull().default('customer'),
  // Hash argon2id. NULL = compte sans mot de passe (ex. futur OAuth) : connexion par mot de passe impossible.
  passwordHash: text('password_hash'),
  ...timestamps,
});
