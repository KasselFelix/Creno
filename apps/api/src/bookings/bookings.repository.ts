import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, isNull, lt, sql } from 'drizzle-orm';
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
  MAX_RESCHEDULES_PER_BOOKING,
  type PaymentStatus,
  type ProviderBookingsQuery,
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
  rescheduledAt: Date | null;
  rescheduleCount: number;
}

/** Une réservation vue par le prestataire : avec son client et la durée actuelle des créneaux. */
export interface ProviderBookingRow extends BookingDetailRow {
  customerName: string;
  customerEmail: string;
  slotMinutes: number;
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
  rescheduledAt: bookings.rescheduledAt,
  rescheduleCount: bookings.rescheduleCount,
};

const providerColumns = {
  ...detailColumns,
  customerName: users.fullName,
  customerEmail: users.email,
  slotMinutes: resources.slotMinutes,
};

/** Hold dont l'échéance n'est pas passée. */
const activeHold = and(eq(bookings.status, 'pending'), sql`${bookings.expiresAt} > now()`);

/**
 * « À venir » : réservations confirmées et holds actifs dont le créneau n'est pas terminé.
 * « Historique » : tout le reste, sauf les holds expirés sans paiement (paniers abandonnés).
 */
const upcoming = sql`upper(${bookings.during}) > now() AND (${bookings.status} = 'confirmed' OR (${bookings.status} = 'pending' AND ${bookings.expiresAt} > now()))`;
const history = sql`NOT (${upcoming}) AND (${bookings.status} IN ('confirmed', 'cancelled') OR ${payments.id} IS NOT NULL)`;

/**
 * Ce que voit le prestataire : réservations confirmées, réservations annulées APRÈS avoir été
 * confirmées, et holds qui courent encore. Un hold expiré ou annulé avant paiement est un panier
 * abandonné : il n'apparaît jamais (et son client avec).
 */
const visibleToProvider = sql`(${bookings.status} = 'confirmed' OR (${bookings.status} = 'cancelled' AND ${bookings.confirmedAt} IS NOT NULL) OR (${bookings.status} = 'pending' AND ${bookings.expiresAt} > now()))`;

/** Ce qui occupe un créneau : réservation confirmée, ou hold qui court encore. */
const occupiesSlot = sql`(${bookings.status} = 'confirmed' OR (${bookings.status} = 'pending' AND ${bookings.expiresAt} > now()))`;

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

  /**
   * Ce qu'un utilisateur bloque déjà : ses holds actifs (au total et sur une ressource donnée), et
   * ses réservations gratuites à venir, confirmées sans paiement donc sans autre frein.
   */
  async countCommitments(
    customerId: string,
    resourceId: string,
    tx: Database,
  ): Promise<{ holds: number; holdsOnResource: number; freeUpcoming: number }> {
    const hold = sql`${bookings.status} = 'pending' AND ${bookings.expiresAt} > now()`;
    const freeUpcoming = sql`${bookings.status} = 'confirmed' AND ${bookings.priceCents} = 0 AND upper(${bookings.during}) > now()`;
    const [row] = await tx
      .select({
        holds: sql<number>`count(*) FILTER (WHERE ${hold})`.mapWith(Number),
        holdsOnResource:
          sql<number>`count(*) FILTER (WHERE ${hold} AND ${bookings.resourceId} = ${resourceId})`.mapWith(
            Number,
          ),
        freeUpcoming: sql<number>`count(*) FILTER (WHERE ${freeUpcoming})`.mapWith(Number),
      })
      .from(bookings)
      .where(and(eq(bookings.customerId, customerId), sql`(${hold}) OR (${freeUpcoming})`));
    return row ?? { holds: 0, holdsOnResource: 0, freeUpcoming: 0 };
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

  private providerDetails(db: Database) {
    return db
      .select(providerColumns)
      .from(bookings)
      .innerJoin(users, eq(users.id, bookings.customerId))
      .innerJoin(resources, eq(resources.id, bookings.resourceId))
      .innerJoin(providers, eq(providers.id, resources.providerId))
      .leftJoin(payments, eq(payments.bookingId, bookings.id));
  }

  async findForProvider(id: string): Promise<ProviderBookingRow | undefined> {
    const [row] = await this.providerDetails(this.handle.db).where(eq(bookings.id, id));
    return row;
  }

  /**
   * Réservations des ressources d'un prestataire, une page à la fois. « À venir » : créneau pas
   * terminé, du plus proche au plus lointain ; « passées » : l'inverse.
   */
  async listForProvider(
    ownerUserId: string,
    { scope, status, resourceId, page, pageSize }: ProviderBookingsQuery,
  ): Promise<{ rows: ProviderBookingRow[]; total: number }> {
    const where = and(
      eq(providers.userId, ownerUserId),
      visibleToProvider,
      scope === 'upcoming'
        ? sql`upper(${bookings.during}) > now()`
        : sql`upper(${bookings.during}) <= now()`,
      status ? eq(bookings.status, status) : undefined,
      resourceId ? eq(bookings.resourceId, resourceId) : undefined,
    );
    const start = sql`lower(${bookings.during})`;
    const [rows, [totals]] = await Promise.all([
      this.providerDetails(this.handle.db)
        .where(where)
        .orderBy(scope === 'upcoming' ? asc(start) : desc(start), asc(bookings.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.handle.db
        .select({ total: count() })
        .from(bookings)
        .innerJoin(resources, eq(resources.id, bookings.resourceId))
        .innerJoin(providers, eq(providers.id, resources.providerId))
        .where(where),
    ]);
    return { rows, total: totals?.total ?? 0 };
  }

  /** Réservations confirmées et holds actifs d'une ressource qui chevauchent la plage. */
  async calendarOf(resourceId: string, range: Interval): Promise<ProviderBookingRow[]> {
    return this.providerDetails(this.handle.db)
      .where(
        and(
          eq(bookings.resourceId, resourceId),
          occupiesSlot,
          sql`${bookings.during} && ${toRange(range.start, range.end)}::tstzrange`,
        ),
      )
      .orderBy(asc(sql`lower(${bookings.during})`));
  }

  /**
   * Verrouille la réservation avant de la déplacer : une annulation concurrente attend la fin de
   * la transaction, et le statut relu ici est celui qui sera modifié.
   */
  async lockForReschedule(
    id: string,
    tx: Database,
  ): Promise<{ status: BookingStatus; start: Date } | undefined> {
    const [row] = await tx
      .select({
        status: bookings.status,
        start: sql<Date>`lower(${bookings.during})`.mapWith(bookings.createdAt),
      })
      .from(bookings)
      .where(eq(bookings.id, id))
      .for('update');
    return row;
  }

  /**
   * Déplace une réservation confirmée et fait avancer sa révision. C'est la contrainte
   * `bookings_no_overlap` qui refuse un créneau déjà occupé (23P01), comme pour un INSERT.
   * Renvoie la nouvelle révision, ou `undefined` si la réservation n'est plus confirmée ou a atteint
   * le plafond de déplacements.
   */
  async reschedule(id: string, slot: Interval, tx: Database): Promise<number | undefined> {
    const [row] = await tx
      .update(bookings)
      .set({
        during: toRange(slot.start, slot.end),
        rescheduleCount: sql`${bookings.rescheduleCount} + 1`,
        rescheduledAt: sql`now()`,
      })
      // Plafond revérifié ici, sous verrou : deux déplacements simultanés ne le dépassent pas.
      .where(
        and(
          eq(bookings.id, id),
          eq(bookings.status, 'confirmed'),
          lt(bookings.rescheduleCount, MAX_RESCHEDULES_PER_BOOKING),
        ),
      )
      .returning({ revision: bookings.rescheduleCount });
    return row?.revision;
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

  /**
   * Annule la prolongation quand la session Checkout n'a pas pu être créée : le hold reprend son
   * échéance d'origine, recalculée (et non relue), pour que des échecs répétés ne l'allongent jamais.
   */
  async revertCheckout(id: string): Promise<void> {
    await this.handle.db
      .update(bookings)
      .set({
        expiresAt: sql`${bookings.createdAt} + make_interval(mins => ${HOLD_MINUTES})`,
        checkoutStartedAt: null,
      })
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
  async confirmFree(id: string, tx: Database): Promise<boolean> {
    const rows = await tx
      .update(bookings)
      .set({ status: 'confirmed', expiresAt: null, confirmedAt: sql`now()` })
      .where(and(eq(bookings.id, id), activeHold, eq(bookings.priceCents, 0)))
      .returning({ id: bookings.id });
    return rows.length > 0;
  }

  /** Annule une réservation si elle a encore le statut attendu. Renvoie vrai si la ligne a changé. */
  async cancel(
    id: string,
    from: 'pending' | 'confirmed',
    tx: Database = this.handle.db,
  ): Promise<boolean> {
    const rows = await tx
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
      .set({
        status: 'confirmed',
        expiresAt: null,
        stripeCheckoutSessionId: sessionId,
        confirmedAt: sql`now()`,
      })
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
