import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { bookings } from './bookings.js';
import { timestamps } from './timestamps.js';
import { users } from './users.js';

export const notificationKind = pgEnum('notification_kind', [
  'booking_confirmed',
  'booking_received',
  'booking_cancelled',
  'booking_cancelled_by_provider',
  'payment_refunded_late',
  'booking_reminder',
  // Ajoutée par `ALTER TYPE … ADD VALUE` : aucune migration ne doit citer cette valeur en SQL (voir
  // docs/schema.md, « Ajouter une valeur à un enum »).
  'booking_moved',
]);

export const notificationChannel = pgEnum('notification_channel', ['email', 'sms']);

export const notificationStatus = pgEnum('notification_status', [
  'scheduled',
  'pending',
  'sent',
  'failed',
  'skipped',
]);

// Outbox des notifications : une ligne par message à envoyer, écrite dans la même transaction que
// le changement de statut de la réservation. Ni adresse ni numéro ici : ils sont relus dans
// `users` au moment de l'envoi.
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'restrict' }),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    kind: notificationKind('kind').notNull(),
    channel: notificationChannel('channel').notNull(),
    status: notificationStatus('status').notNull().default('pending'),
    // Instant d'envoi voulu : tout de suite, sauf pour un rappel (`scheduled` jusqu'à cet instant).
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).defaultNow().notNull(),
    attempts: integer('attempts').notNull().default(0),
    // Révision de la réservation (`bookings.reschedule_count`) pour laquelle le message a été écrit.
    // Seuls le rappel et « réservation déplacée » en dépendent ; les autres types restent à 0.
    bookingRevision: integer('booking_revision').notNull().default(0),
    // Motif d'un `skipped` ou d'un `failed` : un code court, jamais le message du fournisseur.
    reason: text('reason'),
    providerMessageId: text('provider_message_id'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    // Idempotence : un événement rejoué ne crée pas un second message pour le même destinataire.
    // La révision en fait partie : un déplacement crée de nouvelles lignes au lieu de recycler les
    // anciennes, car l'id de la ligne sert de clé d'idempotence chez Resend.
    unique('notifications_booking_kind_channel_recipient_revision_key').on(
      t.bookingId,
      t.kind,
      t.channel,
      t.recipientId,
      t.bookingRevision,
    ),
    // Rappels dus : seules les lignes encore `scheduled` sont indexées.
    index('notifications_scheduled_for_idx')
      .on(t.scheduledFor)
      .where(sql`${t.status} = 'scheduled'`),
    index('notifications_recipient_id_idx').on(t.recipientId),
    check('notifications_attempts_positive', sql`${t.attempts} >= 0`),
    check('notifications_booking_revision_positive', sql`${t.bookingRevision} >= 0`),
    check('notifications_sent_has_date', sql`${t.status} <> 'sent' OR ${t.sentAt} IS NOT NULL`),
    check(
      'notifications_closed_has_reason',
      sql`${t.status} NOT IN ('failed', 'skipped') OR ${t.reason} IS NOT NULL`,
    ),
  ],
);
