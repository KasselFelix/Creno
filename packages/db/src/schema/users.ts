import { pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './timestamps.js';
import { citext } from './types.js';

export const userRole = pgEnum('user_role', ['customer', 'provider', 'admin']);

// Les colonnes d'authentification (mot de passe, sessions) arrivent à l'étape `auth`.
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: citext('email').notNull().unique(),
  fullName: text('full_name').notNull(),
  phone: text('phone'),
  role: userRole('role').notNull().default('customer'),
  ...timestamps,
});
