import { Inject, Injectable, Logger } from '@nestjs/common';
import { addDays, addHours, addMinutes, max, min, subHours } from 'date-fns';
import { type DbHandle, PG_DEADLOCK_DETECTED, retryOnDeadlock, sqlState } from '@creno/db';
import {
  type Booking,
  BOOKING_HORIZON_DAYS,
  type BookingDetail,
  type BookingList,
  type BookingsQuery,
  type Calendar,
  type CalendarQuery,
  type CheckoutResponse,
  type CreateBookingInput,
  FREE_CANCELLATION_HOURS,
  HOLD_MINUTES,
  MAX_ACTIVE_HOLDS,
  MAX_ACTIVE_HOLDS_PER_RESOURCE,
  MAX_FREE_UPCOMING_BOOKINGS,
  MAX_RESCHEDULES_PER_BOOKING,
  platformFeeCents,
  type ProviderBooking,
  type ProviderBookingList,
  type ProviderBookingsQuery,
  type RescheduleBookingInput,
} from '@creno/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { AvailabilityService } from '../availability/availability.service.js';
import { DomainError } from '../common/domain-error.js';
import { mapPgError } from '../common/pg-errors.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { DB } from '../database/database.module.js';
import {
  type CheckoutSession,
  PAYMENTS_GATEWAY,
  type PaymentsGateway,
  PaymentsGatewayError,
} from '../payments/payments-gateway.js';
import { ResourcesService } from '../resources/resources.service.js';
import {
  type BookingDetailRow,
  type BookingRow,
  BookingsRepository,
  type ProviderBookingRow,
} from './bookings.repository.js';

const toBooking = (row: BookingRow): Booking => ({
  id: row.id,
  resourceId: row.resourceId,
  start: row.start.toISOString(),
  end: row.end.toISOString(),
  status: row.status,
  expiresAt: row.expiresAt?.toISOString() ?? null,
  priceCents: row.priceCents,
  currency: row.currency,
});

/** Qui regarde la réservation : son client, ou le prestataire propriétaire de la ressource. */
type Viewer = 'customer' | 'provider';

/**
 * Dernier instant où `viewer` peut annuler, ou `null` s'il ne le peut pas.
 * Client : un hold tant qu'il court, une réservation confirmée jusqu'à 24 h avant le début.
 * Prestataire : une réservation confirmée jusqu'à son début.
 * Réservation déplacée par le prestataire : le client a au moins 24 h après le déplacement pour
 * annuler (sans dépasser le début), puisqu'il n'a pas choisi ce nouvel horaire ; ensuite, la règle
 * habituelle reprend.
 */
function customerCancellationLimit(row: BookingDetailRow): Date {
  const usual = subHours(row.start, FREE_CANCELLATION_HOURS);
  if (row.rescheduledAt === null) return usual;
  const decisionDelay = addHours(row.rescheduledAt, FREE_CANCELLATION_HOURS);
  return min([row.start, max([usual, decisionDelay])]);
}

export function cancellableUntil(row: BookingDetailRow, viewer: Viewer, now: Date): Date | null {
  if (row.status === 'pending') {
    return viewer === 'customer' && row.holdActive ? row.expiresAt : null;
  }
  if (row.status !== 'confirmed') return null;
  const limit = viewer === 'customer' ? customerCancellationLimit(row) : row.start;
  return now < limit ? limit : null;
}

const toDetail = (row: BookingDetailRow, viewer: Viewer, now = new Date()): BookingDetail => ({
  ...toBooking(row),
  resourceName: row.resourceName,
  providerName: row.providerName,
  providerSlug: row.providerSlug,
  timezone: row.timezone,
  paymentStatus: row.paymentStatus,
  refundedCents: row.refundedCents ?? 0,
  checkoutStarted: row.checkoutStartedAt !== null,
  cancellableUntil: cancellableUntil(row, viewer, now)?.toISOString() ?? null,
  rescheduledAt: row.rescheduledAt?.toISOString() ?? null,
});

const durationMinutes = (row: BookingRow) => (row.end.getTime() - row.start.getTime()) / 60_000;

const toProviderBooking = (row: ProviderBookingRow, now: Date): ProviderBooking => ({
  ...toBooking(row),
  resourceName: row.resourceName,
  timezone: row.timezone,
  // Un hold n'expose pas son client : quelqu'un qui n'a pas (encore) payé reste anonyme.
  customer:
    row.status === 'pending' ? null : { fullName: row.customerName, email: row.customerEmail },
  paymentStatus: row.paymentStatus,
  rescheduledAt: row.rescheduledAt?.toISOString() ?? null,
  cancellableUntil: cancellableUntil(row, 'provider', now)?.toISOString() ?? null,
  reschedulable:
    row.status === 'confirmed' &&
    row.start > now &&
    durationMinutes(row) === row.slotMinutes &&
    row.rescheduleCount < MAX_RESCHEDULES_PER_BOOKING,
});

const notFound = () => new DomainError('NOT_FOUND', 404, 'Réservation introuvable.');
const notPayable = () =>
  new DomainError(
    'BOOKING_NOT_PAYABLE',
    409,
    "Cette réservation n'est plus en attente de paiement.",
  );
const paymentsNotReady = () =>
  new DomainError(
    'PROVIDER_PAYMENTS_NOT_READY',
    409,
    "Ce prestataire n'accepte pas encore le paiement en ligne.",
  );
const cancellationNotAllowed = (message: string) =>
  new DomainError('CANCELLATION_NOT_ALLOWED', 409, message);
const rescheduleNotAllowed = (message: string) =>
  new DomainError('RESCHEDULE_NOT_ALLOWED', 409, message);
const slotNotOffered = () =>
  new DomainError('SLOT_NOT_OFFERED', 422, "Ce créneau n'est pas proposé par cette ressource.");
const slotUnavailable = () =>
  new DomainError('SLOT_UNAVAILABLE', 409, "Ce créneau n'est plus disponible.");

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PAYMENTS_GATEWAY) private readonly gateway: PaymentsGateway,
    private readonly bookings: BookingsRepository,
    private readonly resources: ResourcesService,
    private readonly availability: AvailabilityService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Bloque un créneau pendant le paiement (hold de 15 min, booking `pending`).
   *
   * Ce qui empêche la double réservation n'est aucun des contrôles ci-dessous : c'est la contrainte
   * `bookings_no_overlap` de la base, vérifiée au moment de l'INSERT, même quand deux requêtes
   * arrivent en même temps.
   */
  async createHold(current: AuthUser, input: CreateBookingInput): Promise<Booking> {
    const resource = await this.resources.requireActive(input.resourceId);
    const start = new Date(input.start);
    const slot = { start, end: addMinutes(start, resource.slotMinutes) };

    const notOffered = slotNotOffered;
    // Écarte tout de suite une date passée ou lointaine, avant le moindre calcul (dates extrêmes).
    const now = new Date();
    if (start <= now || start > addDays(now, BOOKING_HORIZON_DAYS + 1)) throw notOffered();
    // Distingue « ce créneau n'existe pas » (422) de « ce créneau est pris » (409, plus bas).
    if (!(await this.availability.isOffered(resource, start, now))) throw notOffered();
    // Inutile de bloquer un créneau qui ne pourra pas être payé.
    if (resource.priceCents > 0 && !(await this.bookings.providerAcceptsPayments(resource.id))) {
      throw paymentsNotReady();
    }

    let attempts = 0;
    try {
      const { row, released } = await retryOnDeadlock(() => {
        attempts += 1;
        return this.handle.db.transaction(async (tx) => {
          // Frein au blocage gratuit d'un agenda. Le verrou par client sérialise ses demandes :
          // des requêtes parallèles ne peuvent pas toutes passer sous la limite avant d'insérer.
          await this.bookings.lockCustomer(current.id, tx);
          const held = await this.bookings.countCommitments(current.id, resource.id, tx);
          if (held.holds >= MAX_ACTIVE_HOLDS) {
            throw new DomainError(
              'HOLD_LIMIT_REACHED',
              409,
              `Vous avez déjà ${MAX_ACTIVE_HOLDS} réservations en attente de paiement.`,
            );
          }
          if (held.holdsOnResource >= MAX_ACTIVE_HOLDS_PER_RESOURCE) {
            throw new DomainError(
              'HOLD_LIMIT_REACHED',
              409,
              `Vous avez déjà ${MAX_ACTIVE_HOLDS_PER_RESOURCE} créneaux en attente de paiement sur cette ressource.`,
            );
          }
          // Une réservation gratuite est confirmée sans paiement : sans ce plafond, un seul compte
          // pourrait prendre tous les créneaux d'une ressource gratuite.
          if (resource.priceCents === 0 && held.freeUpcoming >= MAX_FREE_UPCOMING_BOOKINGS) {
            throw new DomainError(
              'HOLD_LIMIT_REACHED',
              409,
              `Vous avez déjà ${MAX_FREE_UPCOMING_BOOKINGS} réservations gratuites à venir.`,
            );
          }
          const released = await this.bookings.expireOverlappingHolds(resource.id, slot, tx);
          const row = await this.bookings.insertHold(
            {
              resourceId: resource.id,
              customerId: current.id,
              slot,
              // Le prix vient toujours de la ressource, jamais du client.
              priceCents: resource.priceCents,
              currency: resource.currency,
            },
            tx,
          );
          return { row, released };
        });
      });
      if (attempts > 1) this.logDeadlockRetry(resource.id, attempts);
      this.logger.log({
        event: 'booking.hold_created',
        bookingId: row.id,
        resourceId: resource.id,
        holdMinutes: HOLD_MINUTES,
        expiredHoldsReleased: released,
      });
      return toBooking(row);
    } catch (error) {
      if (attempts > 1) this.logDeadlockRetry(resource.id, attempts);
      if (error instanceof DomainError) throw error;
      const state = sqlState(error);
      // Un deadlock qui persiste après les rejeux signifie qu'une autre transaction tient le créneau.
      if (state === '23P01' || state === PG_DEADLOCK_DETECTED) {
        this.logger.log({
          event: 'booking.slot_conflict',
          resourceId: resource.id,
          sqlState: state,
        });
        throw slotUnavailable();
      }
      throw mapPgError(error) ?? error;
    }
  }

  /** Réservations des ressources du prestataire connecté (tableau du dashboard). */
  async listForProvider(
    current: AuthUser,
    query: ProviderBookingsQuery,
  ): Promise<ProviderBookingList> {
    if (query.resourceId) await this.resources.requireOwned(current, query.resourceId);
    const { rows, total } = await this.bookings.listForProvider(current.id, query);
    const now = new Date();
    return { items: rows.map((row) => toProviderBooking(row, now)), total };
  }

  /** Réservations confirmées et holds actifs d'une ressource du prestataire, sur une plage. */
  async calendar(current: AuthUser, query: CalendarQuery): Promise<Calendar> {
    await this.resources.requireOwned(current, query.resourceId);
    const rows = await this.bookings.calendarOf(query.resourceId, {
      start: new Date(query.from),
      end: new Date(query.to),
    });
    const now = new Date();
    return { items: rows.map((row) => toProviderBooking(row, now)) };
  }

  /**
   * Déplace une réservation confirmée vers un autre créneau de la même ressource (même durée).
   * Le client est prévenu par email ; le paiement ne change pas.
   *
   * Comme pour la création, ce n'est pas un contrôle applicatif qui empêche de déplacer sur un
   * créneau pris : c'est la contrainte `bookings_no_overlap`, vérifiée au moment de l'UPDATE.
   */
  async reschedule(
    current: AuthUser,
    id: string,
    input: RescheduleBookingInput,
  ): Promise<ProviderBooking> {
    const row = await this.bookings.findDetail(id);
    if (!row) throw notFound();
    // Propriété : la ressource de la réservation doit appartenir au prestataire connecté.
    const resource = await this.resources.requireOwned(current, row.resourceId);
    const now = new Date();
    if (row.status !== 'confirmed' || row.start <= now) {
      throw rescheduleNotAllowed(
        'Seule une réservation confirmée et pas encore commencée peut être déplacée.',
      );
    }
    if (row.rescheduleCount >= MAX_RESCHEDULES_PER_BOOKING) {
      throw rescheduleNotAllowed(
        `Cette réservation a déjà été déplacée ${MAX_RESCHEDULES_PER_BOOKING} fois : annulez-la si le créneau ne convient plus.`,
      );
    }
    if (durationMinutes(row) !== resource.slotMinutes) {
      throw rescheduleNotAllowed(
        'La durée des créneaux de cette ressource a changé depuis cette réservation : annulez-la plutôt.',
      );
    }
    const start = new Date(input.start);
    if (start.getTime() === row.start.getTime()) return this.providerView(id);
    if (start <= now || start > addDays(now, BOOKING_HORIZON_DAYS + 1)) throw slotNotOffered();
    if (!(await this.availability.isOffered(resource, start, now))) throw slotNotOffered();

    const slot = { start, end: addMinutes(start, resource.slotMinutes) };
    let attempts = 0;
    try {
      const { revision, released } = await retryOnDeadlock(() => {
        attempts += 1;
        return this.handle.db.transaction(async (tx) => {
          // Relu sous verrou : une annulation a pu passer depuis la lecture ci-dessus.
          const locked = await this.bookings.lockForReschedule(id, tx);
          if (locked?.status !== 'confirmed' || locked.start <= new Date()) {
            throw rescheduleNotAllowed('Cette réservation vient de changer de statut. Réessayez.');
          }
          const released = await this.bookings.expireOverlappingHolds(resource.id, slot, tx);
          const revision = await this.bookings.reschedule(id, slot, tx);
          if (revision === undefined) {
            throw rescheduleNotAllowed('Cette réservation vient de changer de statut. Réessayez.');
          }
          await this.notifications.bookingRescheduled(id, tx, now);
          return { revision, released };
        });
      });
      if (attempts > 1) this.logDeadlockRetry(resource.id, attempts);
      this.logger.log({
        event: 'booking.rescheduled',
        bookingId: id,
        resourceId: resource.id,
        revision,
        expiredHoldsReleased: released,
      });
    } catch (error) {
      if (attempts > 1) this.logDeadlockRetry(resource.id, attempts);
      if (error instanceof DomainError) throw error;
      const state = sqlState(error);
      if (state === '23P01' || state === PG_DEADLOCK_DETECTED) {
        this.logger.log({
          event: 'booking.slot_conflict',
          resourceId: resource.id,
          sqlState: state,
          operation: 'reschedule',
        });
        throw slotUnavailable();
      }
      throw mapPgError(error) ?? error;
    }
    return this.providerView(id);
  }

  private async providerView(id: string): Promise<ProviderBooking> {
    const row = await this.bookings.findForProvider(id);
    if (!row) throw notFound();
    return toProviderBooking(row, new Date());
  }

  async listMine(current: AuthUser, query: BookingsQuery): Promise<BookingList> {
    const { rows, total } = await this.bookings.listForCustomer(current.id, query);
    const now = new Date();
    return { items: rows.map((row) => toDetail(row, 'customer', now)), total };
  }

  async getOne(current: AuthUser, id: string): Promise<BookingDetail> {
    const { row, viewer } = await this.requireVisible(current, id);
    return toDetail(row, viewer);
  }

  /**
   * Lance le paiement d'un hold : renvoie l'adresse de la page Stripe Checkout. Cette route ne
   * confirme jamais une réservation payante : seul le webhook Stripe le fait.
   */
  async checkout(current: AuthUser, id: string): Promise<CheckoutResponse> {
    const row = await this.requireMine(current, id);
    if (row.status !== 'pending' || !row.holdActive || !row.expiresAt) throw notPayable();

    // Ressource gratuite : rien à encaisser, la réservation est confirmée tout de suite.
    if (row.priceCents === 0) {
      // La confirmation et ses notifications sont validées ensemble (outbox transactionnelle).
      const confirmed = await this.handle.db.transaction(async (tx) => {
        if (!(await this.bookings.confirmFree(id, tx))) return false;
        await this.notifications.bookingConfirmed(id, tx);
        return true;
      });
      if (!confirmed) throw notPayable();
      this.logger.log({ event: 'booking.confirmed', bookingId: id, paid: false });
      return { checkoutUrl: null, booking: toDetail(await this.reload(id), 'customer') };
    }
    if (!row.providerChargesEnabled || !row.providerStripeAccountId) throw paymentsNotReady();

    const extended = await this.bookings.startCheckout(id);
    const fresh = await this.reload(id);
    if (fresh.status !== 'pending' || !fresh.holdActive || !fresh.expiresAt) throw notPayable();

    let session: CheckoutSession;
    try {
      session = fresh.stripeCheckoutSessionId
        ? await this.gateway.retrieveCheckoutSession(fresh.stripeCheckoutSessionId)
        : await this.gateway.createCheckoutSession({
            bookingId: id,
            // Le montant vient du booking (prix de la ressource au moment du hold), la commission
            // est calculée ici : rien ne vient de la requête du client.
            amountCents: fresh.priceCents,
            feeCents: platformFeeCents(fresh.priceCents, this.config.STRIPE_PLATFORM_FEE_BPS),
            currency: fresh.currency,
            destinationAccountId: row.providerStripeAccountId,
            productName: `${fresh.resourceName} — ${fresh.providerName}`,
            description: new Intl.DateTimeFormat('fr-FR', {
              dateStyle: 'full',
              timeStyle: 'short',
              timeZone: fresh.timezone,
            }).format(fresh.start),
            customerEmail: await this.bookings.customerEmail(current.id),
            expiresAt: fresh.expiresAt,
            successUrl: this.confirmationUrl(id, 'success'),
            cancelUrl: this.confirmationUrl(id, 'cancelled'),
          });
    } catch (error) {
      // Le hold reprend son échéance d'origine : le client peut réessayer tant qu'il court.
      if (extended) await this.bookings.revertCheckout(id);
      throw this.gatewayFailure('checkout', id, error);
    }
    if (!fresh.stripeCheckoutSessionId) {
      await this.bookings.setCheckoutSession(id, session.sessionId);
    }
    // Session déjà payée ou expirée chez Stripe : le webhook mettra la réservation à jour.
    if (!session.url) throw notPayable();
    this.logger.log({
      event: 'booking.checkout_started',
      bookingId: id,
      resourceId: fresh.resourceId,
      resumed: !extended,
    });
    return { checkoutUrl: session.url, booking: toDetail(fresh, 'customer') };
  }

  /**
   * Annule une réservation. Pour une réservation payée, le remboursement est demandé AVANT de
   * libérer le créneau : si Stripe échoue, rien ne change et l'appelant peut réessayer (la clé
   * d'idempotence empêche un double remboursement). Le paiement ne passe à `refunded` que par le
   * webhook `charge.refunded`.
   */
  async cancel(current: AuthUser, id: string): Promise<BookingDetail> {
    const { row, viewer } = await this.requireVisible(current, id);
    const now = new Date();
    if (!cancellableUntil(row, viewer, now)) {
      throw cancellationNotAllowed(
        row.status === 'confirmed' && viewer === 'customer' && row.start > now
          ? `L'annulation en ligne n'est plus possible à moins de ${FREE_CANCELLATION_HOURS} h du début.`
          : 'Cette réservation ne peut plus être annulée.',
      );
    }

    if (row.status === 'pending') {
      if (!(await this.bookings.cancel(id, 'pending'))) {
        throw cancellationNotAllowed('Cette réservation vient de changer de statut. Réessayez.');
      }
      // Au mieux : si la session reste ouverte et qu'un paiement arrive, le webhook le rembourse.
      if (row.stripeCheckoutSessionId) {
        await this.gateway.expireCheckoutSession(row.stripeCheckoutSessionId).catch((error) => {
          this.logGatewayFailure('expire_session', id, error);
        });
      }
      this.logger.log({ event: 'booking.cancelled', bookingId: id, by: viewer, refunded: false });
      return toDetail(await this.reload(id), viewer);
    }

    const refund = row.paymentIntentId !== null && row.paymentStatus === 'succeeded';
    if (row.paymentIntentId !== null && refund) {
      try {
        await this.gateway.refund({ paymentIntentId: row.paymentIntentId, bookingId: id });
      } catch (error) {
        throw this.gatewayFailure('refund', id, error);
      }
    }
    const cancelled = await this.handle.db.transaction(async (tx) => {
      if (!(await this.bookings.cancel(id, 'confirmed', tx))) return false;
      await this.notifications.bookingCancelled(id, viewer, tx);
      return true;
    });
    if (!cancelled) {
      throw cancellationNotAllowed('Cette réservation vient de changer de statut. Réessayez.');
    }
    this.logger.log({ event: 'booking.cancelled', bookingId: id, by: viewer, refunded: refund });
    return toDetail(await this.reload(id), viewer);
  }

  /** La réservation, si l'appelant est son client ou le prestataire propriétaire de la ressource. */
  private async requireVisible(
    current: AuthUser,
    id: string,
  ): Promise<{ row: BookingDetailRow; viewer: Viewer }> {
    const row = await this.bookings.findDetail(id);
    if (!row) throw notFound();
    if (row.customerId === current.id) return { row, viewer: 'customer' };
    if (row.ownerUserId === current.id) return { row, viewer: 'provider' };
    throw new DomainError(
      'FORBIDDEN_OWNERSHIP',
      403,
      'Cette réservation appartient à un autre utilisateur.',
    );
  }

  /** La réservation, si l'appelant en est le client (le prestataire ne paie pas à sa place). */
  private async requireMine(current: AuthUser, id: string): Promise<BookingDetailRow> {
    const { row, viewer } = await this.requireVisible(current, id);
    if (viewer !== 'customer') {
      throw new DomainError(
        'FORBIDDEN_OWNERSHIP',
        403,
        'Cette réservation appartient à un autre utilisateur.',
      );
    }
    return row;
  }

  private async reload(id: string): Promise<BookingDetailRow> {
    const row = await this.bookings.findDetail(id);
    if (!row) throw notFound();
    return row;
  }

  /**
   * Adresse de retour après Stripe, construite ici, jamais à partir d'une valeur du client. Elle
   * passe par la page publique `/stripe/return`, qui rejoint ensuite la réservation : voir cette page.
   */
  private confirmationUrl(bookingId: string, outcome: 'success' | 'cancelled'): string {
    return `${this.config.WEB_ORIGIN}/stripe/return?booking=${bookingId}&checkout=${outcome}`;
  }

  private logGatewayFailure(operation: string, bookingId: string, error: unknown): void {
    this.logger.warn({
      event: 'payment.gateway_failed',
      operation,
      bookingId,
      reason: error instanceof PaymentsGatewayError ? error.reason : 'unknown',
      code: error instanceof PaymentsGatewayError ? error.code : undefined,
    });
  }

  /** Une erreur qui ne vient pas de la passerelle est un bug chez nous : elle remonte telle quelle (500). */
  private gatewayFailure(operation: string, bookingId: string, error: unknown): unknown {
    if (!(error instanceof PaymentsGatewayError)) return error;
    this.logGatewayFailure(operation, bookingId, error);
    return new DomainError(
      'PAYMENT_PROVIDER_UNAVAILABLE',
      503,
      'Le paiement est momentanément indisponible. Réessayez dans un instant.',
    );
  }

  private logDeadlockRetry(resourceId: string, attempts: number): void {
    this.logger.warn({ event: 'booking.deadlock_retried', resourceId, attempts });
  }
}
