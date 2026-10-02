import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { citext } from './types.js';
import { userRole } from './users.js';

/**
 * Inscription en attente de confirmation de l'adresse. La ligne `users` n'est créée qu'au clic sur
 * le lien, avec le nom, le rôle et le mot de passe de CETTE tentative : plusieurs tentatives
 * peuvent coexister pour une même adresse (pas d'unicité sur `email`), la première confirmée gagne.
 * Le lien vaut `<id>.<secret>` ; seul sha256(secret) est stocké, écrit au moment de l'envoi.
 */
export const pendingRegistrations = pgTable(
  'pending_registrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: citext('email').notNull(),
    fullName: text('full_name').notNull(),
    role: userRole('role').notNull(),
    passwordHash: text('password_hash').notNull(),
    // NULL tant que l'email n'est pas parti : la ligne n'est alors confirmable par personne.
    tokenHash: text('token_hash'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Plafond d'emails par adresse (tentatives récentes) et suppression à la confirmation.
    index('pending_registrations_email_created_at_idx').on(t.email, t.createdAt),
    // Purge des lignes expirées.
    index('pending_registrations_expires_at_idx').on(t.expiresAt),
    check('pending_registrations_role_registrable', sql`${t.role} IN ('customer', 'provider')`),
    check('pending_registrations_expiry_after_creation', sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);
