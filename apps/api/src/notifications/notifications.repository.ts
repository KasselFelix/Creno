import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, gt, isNotNull, lt, lte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  bookings,
  type Database,
  type DbHandle,
  notifications,
  payments,
  providers,
  resources,
  users,
} from '@creno/db';
import type {
  BookingStatus,
  NotificationChannel,
  NotificationKind,
  NotificationStatus,
} from '@creno/shared';
import { DB } from '../database/database.module.js';

/** Les deux destinataires possibles d'une réservation. */
export interface BookingParties {
  customerId: string;
  customerHasPhone: boolean;
  /** Utilisateur propriétaire du prestataire. */
  ownerUserId: string;
  start: Date;
  /** Révision de l'horaire (`bookings.reschedule_count`). */
  revision: number;
}

export interface NewNotification {
  bookingId: string;
  recipientId: string;
  kind: NotificationKind;
  channel: NotificationChannel;
  status?: 'pending' | 'scheduled';
  scheduledFor?: Date;
  /** Révision de la réservation pour laquelle le message est écrit (0 par défaut). */
  bookingRevision?: number;
}

/** Une notification avec tout ce qu'il faut pour l'écrire et l'adresser. Jamais loggué en entier. */
export interface SendContext {
  id: string;
  bookingId: string;
  recipientId: string;
  kind: NotificationKind;
  channel: NotificationChannel;
  /** Révision pour laquelle la notification a été écrite. */
  revision: number;
  /** Révision actuelle de la réservation : un déplacement l'a peut-être fait avancer depuis. */
  bookingRevision: number;
  recipientEmail: string;
  recipientPhone: string | null;
  recipientName: string;
  /** Le destinataire est le client de la réservation (sinon : le prestataire). */
  recipientIsCustomer: boolean;
  customerName: string;
  bookingStatus: BookingStatus;
  start: Date;
  end: Date;
  currency: string;
  resourceName: string;
  timezone: string;
  providerName: string;
  providerSlug: string;
  paidCents: number | null;
}

const recipient = alias(users, 'recipient');
const customer = alias(users, 'customer');

@Injectable()
export class NotificationsRepository {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async parties(bookingId: string, tx: Database): Promise<BookingParties | undefined> {
    const [row] = await tx
      .select({
        customerId: bookings.customerId,
        customerHasPhone: isNotNull(users.phone).mapWith(Boolean),
        ownerUserId: providers.userId,
        start: sql<Date>`lower(${bookings.during})`.mapWith(bookings.createdAt),
        revision: bookings.rescheduleCount,
      })
      .from(bookings)
      .innerJoin(users, eq(users.id, bookings.customerId))
      .innerJoin(resources, eq(resources.id, bookings.resourceId))
      .innerJoin(providers, eq(providers.id, resources.providerId))
      .where(eq(bookings.id, bookingId));
    return row;
  }

  /**
   * Insère les notifications qui n'existent pas encore. La contrainte d'unicité (réservation, type,
   * canal, destinataire) fait l'idempotence : un événement rejoué n'insère rien, donc ne renvoie rien.
   */
  async insert(
    rows: NewNotification[],
    tx: Database,
  ): Promise<{ id: string; status: NotificationStatus }[]> {
    if (rows.length === 0) return [];
    return tx
      .insert(notifications)
      .values(rows)
      .onConflictDoNothing()
      .returning({ id: notifications.id, status: notifications.status });
  }

  /**
   * Ferme les rappels pas encore libérés d'une réservation dont l'horaire vient de changer : ils
   * visaient l'ancien horaire. Un rappel déjà libéré (`pending`) est écarté par le worker, qui
   * compare les révisions. Renvoie le nombre de rappels fermés.
   */
  async skipScheduledReminders(bookingId: string, tx: Database): Promise<number> {
    const rows = await tx
      .update(notifications)
      .set({ status: 'skipped', reason: 'rescheduled' })
      .where(
        and(
          eq(notifications.bookingId, bookingId),
          eq(notifications.kind, 'booking_reminder'),
          eq(notifications.status, 'scheduled'),
        ),
      )
      .returning({ id: notifications.id });
    return rows.length;
  }

  /**
   * Passe en `pending` les notifications planifiées dont l'heure est venue, et renvoie leurs
   * identifiants. `SKIP LOCKED` : deux instances qui passent en même temps se partagent les lignes
   * au lieu de s'attendre.
   */
  async releaseDue(tx: Database, limit = 500): Promise<string[]> {
    const due = tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(eq(notifications.status, 'scheduled'), lte(notifications.scheduledFor, sql`now()`)),
      )
      .orderBy(asc(notifications.scheduledFor))
      .limit(limit)
      .for('update', { skipLocked: true });
    const rows = await tx
      .update(notifications)
      .set({ status: 'pending' })
      // `= ANY(ARRAY(…))` : la sous-requête est évaluée une fois, puis l'UPDATE passe par la clé
      // primaire. Avec `IN (…)`, Postgres relisait toute la table (semi-jointure par hachage).
      .where(sql`${notifications.id} = ANY(ARRAY(${due}))`)
      .returning({ id: notifications.id });
    return rows.map((row) => row.id);
  }

  /**
   * Prend l'essai n° `attempt` d'une notification à envoyer. Renvoie faux si elle n'est plus à
   * envoyer, ou si cet essai a déjà été pris (même job livré deux fois) : la condition sur
   * `attempts` fait le travail d'un verrou, sans transaction ouverte pendant l'envoi.
   */
  async startAttempt(id: string, attempt: number): Promise<boolean> {
    const rows = await this.handle.db
      .update(notifications)
      .set({ attempts: attempt })
      .where(
        and(
          eq(notifications.id, id),
          eq(notifications.status, 'pending'),
          lt(notifications.attempts, attempt),
        ),
      )
      .returning({ id: notifications.id });
    return rows.length > 0;
  }

  /** Messages déjà envoyés à ce destinataire sur ce canal depuis `hours` heures. */
  async recentlySent(
    recipientId: string,
    channel: NotificationChannel,
    hours: number,
  ): Promise<number> {
    const [row] = await this.handle.db
      .select({ total: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientId, recipientId),
          eq(notifications.channel, channel),
          eq(notifications.status, 'sent'),
          gt(notifications.sentAt, sql`now() - make_interval(hours => ${hours})`),
        ),
      );
    return row?.total ?? 0;
  }

  async sendContext(id: string): Promise<SendContext | undefined> {
    const [row] = await this.handle.db
      .select({
        id: notifications.id,
        bookingId: notifications.bookingId,
        recipientId: notifications.recipientId,
        kind: notifications.kind,
        channel: notifications.channel,
        revision: notifications.bookingRevision,
        bookingRevision: bookings.rescheduleCount,
        recipientEmail: recipient.email,
        recipientPhone: recipient.phone,
        recipientName: recipient.fullName,
        recipientIsCustomer: sql<boolean>`${notifications.recipientId} = ${bookings.customerId}`,
        customerName: customer.fullName,
        bookingStatus: bookings.status,
        start: sql<Date>`lower(${bookings.during})`.mapWith(bookings.createdAt),
        end: sql<Date>`upper(${bookings.during})`.mapWith(bookings.createdAt),
        currency: bookings.currency,
        resourceName: resources.name,
        timezone: resources.timezone,
        providerName: providers.name,
        providerSlug: providers.slug,
        paidCents: payments.amountCents,
      })
      .from(notifications)
      .innerJoin(recipient, eq(recipient.id, notifications.recipientId))
      .innerJoin(bookings, eq(bookings.id, notifications.bookingId))
      .innerJoin(customer, eq(customer.id, bookings.customerId))
      .innerJoin(resources, eq(resources.id, bookings.resourceId))
      .innerJoin(providers, eq(providers.id, resources.providerId))
      .leftJoin(payments, eq(payments.bookingId, bookings.id))
      .where(eq(notifications.id, id));
    return row;
  }

  async markSent(id: string, providerMessageId: string | null): Promise<void> {
    await this.handle.db
      .update(notifications)
      .set({ status: 'sent', sentAt: sql`now()`, providerMessageId, reason: null })
      .where(and(eq(notifications.id, id), eq(notifications.status, 'pending')));
  }

  /** Clôt une notification sans envoi. Renvoie vrai si la ligne a changé. */
  async close(id: string, status: 'skipped' | 'failed', reason: string): Promise<boolean> {
    const rows = await this.handle.db
      .update(notifications)
      .set({ status, reason })
      .where(and(eq(notifications.id, id), eq(notifications.status, 'pending')))
      .returning({ id: notifications.id });
    return rows.length > 0;
  }
}
