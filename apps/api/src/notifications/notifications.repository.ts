import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
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
}

export interface NewNotification {
  bookingId: string;
  recipientId: string;
  kind: NotificationKind;
  channel: NotificationChannel;
  status?: 'pending' | 'scheduled';
  scheduledFor?: Date;
}

/** Une notification avec tout ce qu'il faut pour l'écrire et l'adresser. Jamais loggué en entier. */
export interface SendContext {
  id: string;
  bookingId: string;
  kind: NotificationKind;
  channel: NotificationChannel;
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
      .where(inArray(notifications.id, due))
      .returning({ id: notifications.id });
    return rows.map((row) => row.id);
  }

  /** Compte un essai d'envoi. Renvoie son numéro, ou `undefined` si la notification n'est plus à envoyer. */
  async startAttempt(id: string): Promise<number | undefined> {
    const [row] = await this.handle.db
      .update(notifications)
      .set({ attempts: sql`${notifications.attempts} + 1` })
      .where(and(eq(notifications.id, id), eq(notifications.status, 'pending')))
      .returning({ attempts: notifications.attempts });
    return row?.attempts;
  }

  async sendContext(id: string): Promise<SendContext | undefined> {
    const [row] = await this.handle.db
      .select({
        id: notifications.id,
        bookingId: notifications.bookingId,
        kind: notifications.kind,
        channel: notifications.channel,
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
