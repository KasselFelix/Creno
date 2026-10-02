import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  bookings,
  type Database,
  type DbHandle,
  payments,
  providers,
  resources,
  toRange,
  users,
} from '@creno/db';
import {
  type BookingsQuery,
  type BookingStatus,
  CHECKOUT_MINUTES,
  HOLD_MINUTES,
  type PaymentStatus,
} from '@creno/shared';
import type { Interval } from '../availability/slots.engine.js';
import { DB } from '../database/database.module.js';

export interface BookingRow extends Interval {
  id: string;
  resourceId: string;
  status: BookingStatus;
  expiresAt: Date | null;
  priceCents: number;
  currency: string;
}

/** Une réservation avec sa ressource, son prestataire et son paiement éventuel. */
export interface BookingDetailRow extends BookingRow {
  customerId: string;
  /** Le hold court encore, d'après l'horloge de la base (celle qui l'expire). */
  holdActive: boolean;
  checkoutStartedAt: Date | null;
  stripeCheckoutSessionId: string | null;
  resourceName: string;
  timezone: string;
  providerName: string;
  providerSlug: string;
  /** Utilisateur propriétaire du prestataire, pour le contrôle de propriété. */
  ownerUserId: string;
  providerStripeAccountId: string | null;
  providerChargesEnabled: boolean;
  paymentStatus: PaymentStatus | null;
  refundedCents: number | null;
  paymentIntentId: string | null;
}

const bookingColumns = {
  id: bookings.id,
  resourceId: bookings.resourceId,
  status: bookings.status,
  expiresAt: bookings.expiresAt,
  priceCents: bookings.priceCents,
  currency: bookings.currency,
  start: sql<Date>`lower(${bookings.during})`.mapWith(bookings.createdAt),
  end: sql<Date>`upper(${bookings.during})`.mapWith(bookings.createdAt),
};

const detailColumns = {
  ...bookingColumns,
  customerId: bookings.customerId,
  holdActive: sql<boolean>`coalesce(${bookings.expiresAt} > now(), false)`,
  checkoutStartedAt: bookings.checkoutStartedAt,
  stripeCheckoutSessionId: bookings.stripeCheckoutSessionId,
  resourceName: resources.name,
  timezone: resources.timezone,
  providerName: providers.name,
  providerSlug: providers.slug,
  ownerUserId: providers.userId,
  providerStripeAccountId: providers.stripeAccountId,
  providerChargesEnabled: providers.stripeChargesEnabled,
  paymentStatus: payments.status,
  refundedCents: payments.refundedCents,
  paymentIntentId: payments.stripePaymentIntentId,
};

/** Hold dont l'échéance n'est pas passée. */
const activeHold = and(eq(bookings.status, 'pending'), sql`${bookings.expiresAt} > now()`);

/**
 * « À venir » : réservations confirmées et holds actifs dont le créneau n'est pas terminé.
 * « Historique » : tout le reste, sauf les holds expirés sans paiement (paniers abandonnés).
 */
const upcoming = sql`upper(${bookings.during}) > now() AND (${bookings.status} = 'confirmed' OR (${bookings.status} = 'pending' AND ${bookings.expiresAt} > now()))`;
const history = sql`NOT (${upcoming}) AND (${bookings.status} IN ('confirmed', 'cancelled') OR ${payments.id} IS NOT NULL)`;

@Injectable()
export class BookingsRepository {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /**
   * Verrou consultatif par client, relâché à la fin de la transaction : deux demandes du même
   * client passent l'une après l'autre, sans bloquer celles des autres clients.
   */
  async lockCustomer(customerId: string, tx: Database): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${customerId}, 0))`);
  }

  /** Holds encore actifs d'un utilisateur : au total, et sur une ressource donnée. */
  async countActiveHolds(
    customerId: string,
    resourceId: string,
    tx: Database,
  ): Promise<{ total: number; onResource: number }> {
    const [row] = await tx
      .select({
        total: count(),
        onResource:
          sql<number>`count(*) FILTER (WHERE ${bookings.resourceId} = ${resourceId})`.mapWith(
            Number,
          ),
      })
      .from(bookings)
      .where(and(eq(bookings.customerId, customerId), activeHold));
    return { total: row?.total ?? 0, onResource: row?.onResource ?? 0 };
  }

  /** Vrai si le prestataire de la ressource peut encaisser un paiement en ligne. */
  async providerAcceptsPayments(resourceId: string): Promise<boolean> {
    const [row] = await this.handle.db
      .select({ enabled: providers.stripeChargesEnabled })
      .from(resources)
      .innerJoin(providers, eq(providers.id, resources.providerId))
      .where(eq(resources.id, resourceId));
    return row?.enabled ?? false;
  }

  /**
   * Passe à `expired` les holds expirés qui chevauchent le créneau. Le prédicat de la contrainte
   * EXCLUDE ne peut pas utiliser now() : sans ce changement de statut, un hold expiré bloquerait
   * encore l'INSERT qui suit. Renvoie le nombre de holds libérés.
   */
  async expireOverlappingHolds(resourceId: string, slot: Interval, tx: Database): Promise<number> {
    const rows = await tx
      .update(bookings)
      .set({ status: 'expired' })
      .where(
        and(
          eq(bookings.resourceId, resourceId),
          eq(bookings.status, 'pending'),
          sql`${bookings.expiresAt} <= now()`,
          sql`${bookings.during} && ${toRange(slot.start, slot.end)}::tstzrange`,
        ),
      )
      .returning({ id: bookings.id });
    return rows.length;
  }

  /** Insère le hold. `expires_at` est calculé par la base : la même horloge que celle qui l'expire. */
  async insertHold(
    values: {
      resourceId: string;
      customerId: string;
      slot: Interval;
      priceCents: number;
      currency: string;
    },
    tx: Database,
  ): Promise<BookingRow> {
    const [row] = await tx
      .insert(bookings)
      .values({
        resourceId: values.resourceId,
        customerId: values.customerId,
        during: toRange(values.slot.start, values.slot.end),
        status: 'pending',
        expiresAt: sql`now() + make_interval(mins => ${HOLD_MINUTES})`,
        priceCents: values.priceCents,
        currency: values.currency,
      })
      .returning(bookingColumns);
    return row!;
  }

  private details(db: Database) {
    return db
      .select(detailColumns)
      .from(bookings)
      .innerJoin(resources, eq(resources.id, bookings.resourceId))
      .innerJoin(providers, eq(providers.id, resources.providerId))
      .leftJoin(payments, eq(payments.bookingId, bookings.id));
  }

  async findDetail(
    id: string,
    tx: Database = this.handle.db,
  ): Promise<BookingDetailRow | undefined> {
    const [row] = await this.details(tx).where(eq(bookings.id, id));
    return row;
  }

  /** Réservations d'un client, une page à la fois. */
  async listForCustomer(
    customerId: string,
    { scope, page, pageSize }: BookingsQuery,
  ): Promise<{ rows: BookingDetailRow[]; total: number }> {
    const where = and(
      eq(bookings.customerId, customerId),
      scope === 'upcoming' ? upcoming : history,
    );
    const start = sql`lower(${bookings.during})`;
    const [rows, [totals]] = await Promise.all([
      this.details(this.handle.db)
        .where(where)
        .orderBy(scope === 'upcoming' ? asc(start) : desc(start), asc(bookings.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.handle.db
        .select({ total: count() })
        .from(bookings)
        .leftJoin(payments, eq(payments.bookingId, bookings.id))
        .where(where),
    ]);
    return { rows, total: totals?.total ?? 0 };
  }

  /** Email du client, transmis à Stripe pour préremplir la page de paiement. Jamais loggué. */
  async customerEmail(customerId: string): Promise<string | undefined> {
    const [row] = await this.handle.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, customerId));
    return row?.email;
  }

  /**
   * Lance le paiement : prolonge le hold, une seule fois, jusqu'à la fin de la session Checkout
   * (Stripe impose une session d'au moins 30 min). Sans effet si le paiement est déjà lancé ou si
   * le hold est expiré. Renvoie vrai si le hold vient d'être prolongé.
   */
  async startCheckout(id: string): Promise<boolean> {
    const rows = await this.handle.db
      .update(bookings)
      .set({
        expiresAt: sql`now() + make_interval(mins => ${CHECKOUT_MINUTES})`,
        checkoutStartedAt: sql`now()`,
      })
      .where(and(eq(bookings.id, id), activeHold, isNull(bookings.checkoutStartedAt)))
      .returning({ id: bookings.id });
    return rows.length > 0;
  }

  /** Annule la prolongation quand la session Checkout n'a pas pu être créée. */
  async revertCheckout(id: string, previousExpiresAt: Date): Promise<void> {
    await this.handle.db
      .update(bookings)
      .set({ expiresAt: previousExpiresAt, checkoutStartedAt: null })
      .where(
        and(
          eq(bookings.id, id),
          eq(bookings.status, 'pending'),
          isNull(bookings.stripeCheckoutSessionId),
        ),
      );
  }

  async setCheckoutSession(id: string, sessionId: string): Promise<void> {
    await this.handle.db
      .update(bookings)
      .set({ stripeCheckoutSessionId: sessionId })
      .where(and(eq(bookings.id, id), isNull(bookings.stripeCheckoutSessionId)));
  }

  /** Confirme sans paiement un hold actif sur une ressource gratuite. Renvoie vrai si la ligne a changé. */
  async confirmFree(id: string): Promise<boolean> {
    const rows = await this.handle.db
      .update(bookings)
      .set({ status: 'confirmed', expiresAt: null })
      .where(and(eq(bookings.id, id), activeHold, eq(bookings.priceCents, 0)))
      .returning({ id: bookings.id });
    return rows.length > 0;
  }

  /** Annule une réservation si elle a encore le statut attendu. Renvoie vrai si la ligne a changé. */
  async cancel(id: string, from: 'pending' | 'confirmed'): Promise<boolean> {
    const rows = await this.handle.db
      .update(bookings)
      .set({ status: 'cancelled', cancelledAt: sql`now()`, expiresAt: null })
      .where(and(eq(bookings.id, id), eq(bookings.status, from)))
      .returning({ id: bookings.id });
    return rows.length > 0;
  }

  /**
   * Verrouille la réservation le temps de traiter un événement de paiement : deux événements
   * pour la même réservation passent l'un après l'autre.
   */
  async lockForPayment(
    id: string,
    tx: Database,
  ): Promise<
    | {
        id: string;
        resourceId: string;
        status: BookingStatus;
        priceCents: number;
        currency: string;
        stripeCheckoutSessionId: string | null;
      }
    | undefined
  > {
    const [row] = await tx
      .select({
        id: bookings.id,
        resourceId: bookings.resourceId,
        status: bookings.status,
        priceCents: bookings.priceCents,
        currency: bookings.currency,
        stripeCheckoutSessionId: bookings.stripeCheckoutSessionId,
      })
      .from(bookings)
      .where(eq(bookings.id, id))
      .for('update');
    return row;
  }

  /**
   * Confirme une réservation payée. Pour une réservation `expired`, c'est un retour parmi les
   * statuts actifs : la contrainte `bookings_no_overlap` est revérifiée et lève 23P01 si le
   * créneau a été repris entre-temps.
   */
  async confirmPaid(id: string, sessionId: string, tx: Database): Promise<void> {
    await tx
      .update(bookings)
      .set({ status: 'confirmed', expiresAt: null, stripeCheckoutSessionId: sessionId })
      .where(eq(bookings.id, id));
  }

  /** Session Checkout expirée sans paiement : le hold est libéré. Renvoie vrai si la ligne a changé. */
  async expireHold(id: string, tx: Database): Promise<boolean> {
    const rows = await tx
      .update(bookings)
      .set({ status: 'expired' })
      .where(and(eq(bookings.id, id), eq(bookings.status, 'pending')))
      .returning({ id: bookings.id });
    return rows.length > 0;
  }
}
