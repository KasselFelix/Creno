import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { type Database, type DbHandle, retryOnDeadlock, sqlState } from '@creno/db';
import { type BookingStatus, platformFeeCents } from '@creno/shared';
import { BookingsRepository } from '../bookings/bookings.repository.js';
import { DomainError } from '../common/domain-error.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { DB } from '../database/database.module.js';
import { PAYMENTS_GATEWAY, type PaymentsGateway } from './payments-gateway.js';
import { PaymentsRepository } from './payments.repository.js';
import {
  InvalidWebhookSignatureError,
  StripeWebhookVerifier,
  type VerifiedStripeEvent,
} from './stripe-webhook-verifier.js';

// On ne lit des objets Stripe que les champs dont on a besoin, validés : leur forme exacte dépend
// de la version d'API de l'endpoint, pas de la nôtre.
const idOrObject = z.union([z.string(), z.object({ id: z.string() }).transform((o) => o.id)]);

const sessionSchema = z.object({
  id: z.string(),
  payment_status: z.string().optional(),
  amount_total: z.number().int().nullish(),
  currency: z.string().nullish(),
  payment_intent: idOrObject.nullish(),
  client_reference_id: z.string().nullish(),
  metadata: z.record(z.string(), z.string()).nullish(),
});

const chargeSchema = z.object({
  payment_intent: idOrObject.nullish(),
  // Stripe recopie sur le paiement les métadonnées posées à la création de la session.
  metadata: z.record(z.string(), z.string()).nullish(),
  amount_refunded: z.number().int().min(0),
  refunded: z.boolean(),
});

const accountSchema = z.object({
  id: z.string(),
  // Un compte « destinataire » reçoit des transferts : c'est cette capacité qui l'active chez nous.
  capabilities: z.object({ transfers: z.string().optional() }).nullish(),
  details_submitted: z.boolean(),
});

type Outcome =
  | { kind: 'duplicate' | 'ignored' | 'noop' }
  | { kind: 'unmatched'; reason: string }
  | { kind: 'confirmed'; bookingId: string; resourceId: string; reactivated: boolean }
  | { kind: 'late_refund'; bookingId: string; reason: 'slot_taken' | 'booking_cancelled' }
  | { kind: 'amount_mismatch'; bookingId: string }
  | { kind: 'hold_released'; bookingId: string }
  | { kind: 'refunded'; bookingId: string; full: boolean; bookingStatus: BookingStatus | null }
  | { kind: 'account_synced'; providerId: string; changed: boolean; chargesEnabled: boolean };

const unmatched = (reason: string): Outcome => ({ kind: 'unmatched', reason });

type LateRefundReason = 'slot_taken' | 'booking_cancelled';

/**
 * Le paiement reçu ne peut pas être honoré : il faut le rembourser. Levée DANS la transaction pour
 * l'annuler : l'appel à Stripe se fait ensuite hors transaction, sans tenir de verrou.
 */
class RefundRequired extends Error {
  constructor(
    readonly bookingId: string,
    readonly paymentIntentId: string,
    readonly reason: LateRefundReason,
  ) {
    super('Remboursement requis');
    this.name = 'RefundRequired';
  }
}

/** L'événement arrive trop tôt : on ne l'enregistre pas et Stripe le renverra (toute réponse hors 2xx). */
const retryLater = () => new DomainError('INTERNAL_ERROR', 503, 'Événement à renvoyer.');

/**
 * Traite les événements Stripe. C'est le seul endroit qui confirme une réservation payante et qui
 * écrit dans `payments` : le statut d'un paiement ne vient jamais de la redirection du navigateur.
 */
@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PAYMENTS_GATEWAY) private readonly gateway: PaymentsGateway,
    private readonly verifier: StripeWebhookVerifier,
    private readonly payments: PaymentsRepository,
    private readonly bookings: BookingsRepository,
  ) {}

  async receive(rawBody: Buffer | undefined, signature: string | undefined): Promise<void> {
    let event: VerifiedStripeEvent;
    try {
      event = this.verifier.verify(rawBody, signature);
    } catch (error) {
      if (!(error instanceof InvalidWebhookSignatureError)) throw error;
      this.logger.warn({ event: 'stripe.webhook_invalid_signature' });
      throw new DomainError('INVALID_WEBHOOK_SIGNATURE', 400, 'Signature invalide.');
    }

    // L'événement est enregistré et traité dans la même transaction : si le traitement échoue,
    // l'enregistrement est annulé lui aussi, la réponse est une 500 et Stripe renvoie l'événement.
    const run = (refunded?: RefundRequired) =>
      retryOnDeadlock(() =>
        this.handle.db.transaction(async (tx) => {
          if (!(await this.payments.recordEvent(event, tx)))
            return { kind: 'duplicate' } as Outcome;
          return this.process(event, tx, refunded);
        }),
      );

    let outcome: Outcome;
    try {
      outcome = await run();
    } catch (error) {
      if (!(error instanceof RefundRequired)) throw error;
      // Paiement arrivé trop tard. La transaction est annulée, rien n'est enregistré : on rembourse
      // d'abord (sans verrou ni connexion tenus pendant l'appel), puis on enregistre. Si Stripe
      // échoue ici, l'erreur remonte (500) et Stripe renvoie l'événement ; la clé d'idempotence du
      // remboursement rend ce rejeu sûr.
      await this.gateway.refund({
        paymentIntentId: error.paymentIntentId,
        bookingId: error.bookingId,
      });
      outcome = await run(error);
    }
    this.report(event, outcome);
  }

  private process(
    event: VerifiedStripeEvent,
    tx: Database,
    refunded?: RefundRequired,
  ): Promise<Outcome> | Outcome {
    // Les paiements sont créés sur le compte de la plateforme : un événement de paiement venu d'un
    // compte connecté ne peut pas être l'un des nôtres, quelles que soient ses métadonnées.
    if (event.connect && event.type !== 'account.updated') return unmatched('connect_event');
    switch (event.type) {
      case 'checkout.session.completed':
        return this.onCheckoutCompleted(event.object, tx, refunded);
      case 'checkout.session.expired':
        return this.onCheckoutExpired(event.object, tx);
      case 'charge.refunded':
        return this.onChargeRefunded(event.object, tx);
      case 'account.updated':
        return this.onAccountUpdated(event.object, tx);
      default:
        return { kind: 'ignored' };
    }
  }

  /** Retrouve et verrouille la réservation désignée par les métadonnées de la session. */
  private async bookingOf(session: z.infer<typeof sessionSchema>, tx: Database) {
    const bookingId = z.uuid().safeParse(session.metadata?.bookingId);
    if (!bookingId.success) return unmatched('no_booking_id');
    const booking = await this.bookings.lockForPayment(bookingId.data, tx);
    if (!booking) return unmatched('unknown_booking');
    if (booking.stripeCheckoutSessionId && booking.stripeCheckoutSessionId !== session.id) {
      return unmatched('other_session');
    }
    // Nos sessions portent la réservation à deux endroits (`client_reference_id` et métadonnées).
    if (session.client_reference_id !== booking.id) return unmatched('other_session');
    return booking;
  }

  /** `refunded` : second passage, après le remboursement d'un paiement arrivé trop tard. */
  private async onCheckoutCompleted(
    object: unknown,
    tx: Database,
    refunded?: RefundRequired,
  ): Promise<Outcome> {
    const parsed = sessionSchema.safeParse(object);
    if (!parsed.success) return unmatched('invalid_payload');
    const session = parsed.data;
    const booking = await this.bookingOf(session, tx);
    if ('kind' in booking) return booking;
    if (session.payment_status !== 'paid') return unmatched('not_paid');
    if (!session.payment_intent) return unmatched('no_payment_intent');
    // Le montant encaissé doit être celui de la réservation : sinon on ne confirme rien.
    if (
      session.amount_total !== booking.priceCents ||
      session.currency?.toUpperCase() !== booking.currency
    ) {
      return { kind: 'amount_mismatch', bookingId: booking.id };
    }
    // Un autre événement a déjà enregistré ce paiement (ex. deux événements pour la même session).
    if (await this.payments.findByBooking(booking.id, tx)) return { kind: 'noop' };

    const fee = Number(session.metadata?.feeCents);
    await this.payments.insert(
      {
        bookingId: booking.id,
        stripePaymentIntentId: session.payment_intent,
        amountCents: booking.priceCents,
        // La commission est celle que le serveur a transmise à Stripe en créant la session.
        feeCents:
          Number.isInteger(fee) && fee >= 0 && fee <= booking.priceCents
            ? fee
            : platformFeeCents(booking.priceCents, this.config.STRIPE_PLATFORM_FEE_BPS),
        currency: booking.currency,
      },
      tx,
    );

    // Le remboursement est fait : il ne reste qu'à garder la trace du paiement reçu. Le statut de
    // la réservation ne bouge pas, même si le créneau s'est libéré entre-temps.
    if (refunded?.bookingId === booking.id) {
      return { kind: 'late_refund', bookingId: booking.id, reason: refunded.reason };
    }

    const confirmed = (reactivated: boolean): Outcome => ({
      kind: 'confirmed',
      bookingId: booking.id,
      resourceId: booking.resourceId,
      reactivated,
    });
    switch (booking.status) {
      case 'confirmed':
        return confirmed(false);
      case 'pending':
        // Même si l'échéance du hold est passée : tant que la ligne est `pending`, elle tient le créneau.
        await this.bookings.confirmPaid(booking.id, session.id, tx);
        return confirmed(false);
      case 'expired':
        try {
          // Savepoint : si la contrainte d'exclusion refuse le retour à `confirmed` (créneau
          // repris), seule cette mise à jour est annulée, pas toute la transaction.
          await tx.transaction((savepoint) =>
            this.bookings.confirmPaid(booking.id, session.id, savepoint),
          );
          return confirmed(true);
        } catch (error) {
          if (sqlState(error) !== '23P01') throw error;
        }
        throw new RefundRequired(booking.id, session.payment_intent, 'slot_taken');
      case 'cancelled':
        throw new RefundRequired(booking.id, session.payment_intent, 'booking_cancelled');
    }
  }

  private async onCheckoutExpired(object: unknown, tx: Database): Promise<Outcome> {
    const parsed = sessionSchema.safeParse(object);
    if (!parsed.success) return unmatched('invalid_payload');
    const booking = await this.bookingOf(parsed.data, tx);
    if ('kind' in booking) return booking;
    return (await this.bookings.expireHold(booking.id, tx))
      ? { kind: 'hold_released', bookingId: booking.id }
      : { kind: 'noop' };
  }

  private async onChargeRefunded(object: unknown, tx: Database): Promise<Outcome> {
    const parsed = chargeSchema.safeParse(object);
    if (!parsed.success) return unmatched('invalid_payload');
    const charge = parsed.data;
    if (!charge.payment_intent) return unmatched('no_payment_intent');
    const payment = await this.payments.recordRefund(
      charge.payment_intent,
      { refundedCents: charge.amount_refunded, full: charge.refunded },
      tx,
    );
    if (!payment) {
      // Le remboursement d'une de nos réservations peut arriver avant que son paiement soit
      // enregistré (Stripe ne garantit pas l'ordre des événements) : on le redemande plus tard.
      const bookingId = z.uuid().safeParse(charge.metadata?.bookingId);
      if (bookingId.success && (await this.bookings.lockForPayment(bookingId.data, tx))) {
        this.logger.warn({
          event: 'stripe.webhook_retry_requested',
          reason: 'payment_not_recorded',
        });
        throw retryLater();
      }
      return unmatched('unknown_payment');
    }
    const booking = await this.bookings.lockForPayment(payment.bookingId, tx);
    return {
      kind: 'refunded',
      bookingId: payment.bookingId,
      full: charge.refunded,
      bookingStatus: booking?.status ?? null,
    };
  }

  private async onAccountUpdated(object: unknown, tx: Database): Promise<Outcome> {
    const parsed = accountSchema.safeParse(object);
    if (!parsed.success) return unmatched('invalid_payload');
    const account = parsed.data;
    const change = await this.payments.syncAccount(
      account.id,
      {
        chargesEnabled: account.capabilities?.transfers === 'active',
        detailsSubmitted: account.details_submitted,
      },
      tx,
    );
    if (!change) return unmatched('unknown_account');
    return {
      kind: 'account_synced',
      providerId: change.providerId,
      changed: change.wasEnabled !== change.enabled,
      chargesEnabled: change.enabled,
    };
  }

  /** Logs après le commit : une transaction rejouée (deadlock) ne loggue pas deux fois. */
  private report(event: VerifiedStripeEvent, outcome: Outcome): void {
    const base = { stripeEventId: event.id, type: event.type };
    switch (outcome.kind) {
      case 'duplicate':
        this.logger.log({ event: 'stripe.webhook_duplicate', ...base });
        return;
      case 'unmatched':
        this.logger.warn({ event: 'stripe.webhook_unmatched', ...base, reason: outcome.reason });
        return;
      case 'confirmed':
        this.logger.log({
          event: 'booking.confirmed',
          bookingId: outcome.bookingId,
          resourceId: outcome.resourceId,
          paid: true,
          reactivated: outcome.reactivated,
        });
        this.logger.log({ event: 'payment.succeeded', bookingId: outcome.bookingId });
        break;
      case 'late_refund':
        this.logger.warn({
          event: 'payment.late_refund',
          bookingId: outcome.bookingId,
          reason: outcome.reason,
        });
        break;
      case 'amount_mismatch':
        // Action requise : un paiement a été encaissé pour un montant inattendu.
        this.logger.error({
          event: 'payment.amount_mismatch',
          ...base,
          bookingId: outcome.bookingId,
        });
        break;
      case 'hold_released':
        this.logger.log({ event: 'booking.checkout_abandoned', bookingId: outcome.bookingId });
        break;
      case 'refunded':
        this.logger.log({
          event: 'payment.refunded',
          bookingId: outcome.bookingId,
          full: outcome.full,
          // `confirmed` : remboursement fait hors de Creno (tableau de bord Stripe), ou annulation
          // en cours de validation.
          bookingStatus: outcome.bookingStatus,
        });
        break;
      case 'account_synced':
        if (outcome.changed) {
          this.logger.log({
            event: 'provider.payments_status_changed',
            providerId: outcome.providerId,
            chargesEnabled: outcome.chargesEnabled,
            source: 'webhook',
          });
        }
        break;
      case 'ignored':
      case 'noop':
        break;
    }
    this.logger.log({ event: 'stripe.webhook_received', ...base, outcome: outcome.kind });
  }
}
