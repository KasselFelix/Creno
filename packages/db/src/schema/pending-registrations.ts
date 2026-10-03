import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { citext } from './types.js';

/**
 * Demande d'inscription en attente : une adresse et le hash du lien envoyé, rien d'autre. Le nom,
 * le rôle et le mot de passe sont choisis depuis le lien, par le titulaire de la boîte mail : rien
 * de ce qu'a saisi l'auteur de la demande ne finit dans le compte. Plusieurs demandes peuvent
 * viser la même adresse (pas d'unicité sur `email`) ; leurs liens se valent, le premier utilisé
 * crée le compte et les autres disparaissent. Le lien vaut `<id>.<secret>` ; seul sha256(secret)
 * est stocké, écrit au moment de l'envoi.
 */
export const pendingRegistrations = pgTable(
  'pending_registrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: citext('email').notNull(),
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
    check('pending_registrations_expiry_after_creation', sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);
