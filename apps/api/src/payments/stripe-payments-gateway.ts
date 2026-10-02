import Stripe from 'stripe';
import {
  type CheckoutSession,
  type CheckoutSessionInput,
  type ConnectAccountInput,
  type ConnectAccountState,
  type PaymentsGateway,
  PaymentsGatewayError,
  type PaymentsGatewayFailure,
} from './payments-gateway.js';

const TIMEOUT_MS = 10_000;

/**
 * Fenêtre de temps ajoutée aux clés d'idempotence. Stripe garde 24 h la réponse d'une clé, erreur
 * comprise : avec une clé fixe, une erreur corrigée depuis (configuration du compte, par exemple)
 * serait rejouée telle quelle pendant un jour. La fenêtre couvre le double clic et les rejeux
 * rapprochés, puis laisse passer une nouvelle tentative.
 */
const attemptWindow = (minutes: number) => Math.floor(Date.now() / (minutes * 60_000));

/** Traduit une erreur du SDK Stripe en échec loggable, sans le message (il peut citer un email). */
export function toGatewayError(error: unknown): PaymentsGatewayError {
  if (error instanceof PaymentsGatewayError) return error;
  if (!(error instanceof Stripe.errors.StripeError)) return new PaymentsGatewayError('network');
  const reason = ((): PaymentsGatewayFailure => {
    if (error instanceof Stripe.errors.StripeConnectionError) return 'network';
    if (error instanceof Stripe.errors.StripeRateLimitError) return 'rate_limited';
    if (
      error instanceof Stripe.errors.StripeAuthenticationError ||
      error instanceof Stripe.errors.StripePermissionError
    ) {
      return 'authentication';
    }
    if (
      error instanceof Stripe.errors.StripeInvalidRequestError ||
      error instanceof Stripe.errors.StripeIdempotencyError
    ) {
      return 'invalid_request';
    }
    return 'api_error';
  })();
  return new PaymentsGatewayError(reason, error.code);
}

/** Adapter Stripe Connect : comptes prestataires, sessions Checkout en « destination charge », remboursements. */
export class StripePaymentsGateway implements PaymentsGateway {
  private readonly stripe: Stripe;

  constructor(secretKey: string, stripe?: Stripe) {
    this.stripe =
      stripe ??
      new Stripe(secretKey, {
        // Le SDK rejoue lui-même les erreurs réseau, 409 et 5xx, avec la même clé d'idempotence.
        maxNetworkRetries: 2,
        timeout: TIMEOUT_MS,
        appInfo: { name: 'Creno' },
      });
  }

  /**
   * Compte connecté créé avec l'API Accounts v2 (l'ancienne API est refusée aux nouvelles
   * plateformes). Configuration « destinataire » : le compte reçoit des transferts depuis la
   * plateforme, qui reste le marchand. La plateforme porte les frais et les soldes négatifs, et le
   * prestataire a le tableau de bord Express : c'est l'équivalent d'un compte Express.
   */
  async createConnectAccount(input: ConnectAccountInput): Promise<{ accountId: string }> {
    const account = await this.call(() =>
      this.stripe.v2.core.accounts.create(
        {
          contact_email: input.contactEmail,
          display_name: input.displayName,
          dashboard: 'express',
          identity: { country: 'fr' },
          defaults: {
            responsibilities: { fees_collector: 'application', losses_collector: 'application' },
          },
          configuration: {
            recipient: {
              capabilities: { stripe_balance: { stripe_transfers: { requested: true } } },
            },
          },
          metadata: { providerId: input.providerId },
        },
        { idempotencyKey: `account-${input.providerId}-${attemptWindow(1)}` },
      ),
    );
    return { accountId: account.id };
  }

  async createAccountLink(input: {
    accountId: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<{ url: string }> {
    const link = await this.call(() =>
      this.stripe.v2.core.accountLinks.create({
        account: input.accountId,
        use_case: {
          type: 'account_onboarding',
          account_onboarding: { refresh_url: input.refreshUrl, return_url: input.returnUrl },
        },
      }),
    );
    return { url: link.url };
  }

  async retrieveAccount(accountId: string): Promise<ConnectAccountState> {
    const account = await this.call(() => this.stripe.accounts.retrieve(accountId));
    return {
      // Un compte « destinataire » n'encaisse pas lui-même (`charges_enabled` reste faux) : ce qui
      // compte, c'est qu'il puisse recevoir les transferts de la plateforme.
      chargesEnabled: account.capabilities?.transfers === 'active',
      detailsSubmitted: account.details_submitted,
    };
  }

  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSession> {
    const metadata = { bookingId: input.bookingId, feeCents: String(input.feeCents) };
    const expiresAt = Math.floor(input.expiresAt.getTime() / 1000);
    const session = await this.call(() =>
      this.stripe.checkout.sessions.create(
        {
          mode: 'payment',
          locale: 'fr',
          // Carte uniquement : le paiement est immédiat, donc `checkout.session.completed` = payé.
          allowed_payment_method_types: ['card'],
          customer_email: input.customerEmail,
          client_reference_id: input.bookingId,
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: input.currency.toLowerCase(),
                unit_amount: input.amountCents,
                product_data: { name: input.productName, description: input.description },
              },
            },
          ],
          // Destination charge : le paiement est encaissé par Creno, Stripe en reverse le montant
          // au prestataire et garde `application_fee_amount` pour la plateforme.
          payment_intent_data: {
            application_fee_amount: input.feeCents,
            transfer_data: { destination: input.destinationAccountId },
            metadata,
          },
          metadata,
          expires_at: expiresAt,
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
        },
        // L'échéance fait partie de la clé : deux appels pour la même échéance rendent la même
        // session ; après un échec, le hold reprend son ancienne échéance et la suivante diffère.
        { idempotencyKey: `checkout-${input.bookingId}-${expiresAt}` },
      ),
    );
    return { sessionId: session.id, url: session.url };
  }

  async retrieveCheckoutSession(sessionId: string): Promise<CheckoutSession> {
    const session = await this.call(() => this.stripe.checkout.sessions.retrieve(sessionId));
    return { sessionId: session.id, url: session.status === 'open' ? session.url : null };
  }

  async expireCheckoutSession(sessionId: string): Promise<void> {
    try {
      await this.stripe.checkout.sessions.expire(sessionId);
    } catch (error) {
      // Stripe refuse d'expirer une session déjà payée ou expirée : il n'y a alors rien à fermer.
      if (error instanceof Stripe.errors.StripeInvalidRequestError) return;
      throw toGatewayError(error);
    }
  }

  async refund(input: { paymentIntentId: string; bookingId: string }): Promise<void> {
    try {
      await this.stripe.refunds.create(
        {
          payment_intent: input.paymentIntentId,
          // Reprend l'argent déjà versé au prestataire et rend la commission de la plateforme.
          reverse_transfer: true,
          refund_application_fee: true,
          metadata: { bookingId: input.bookingId },
        },
        { idempotencyKey: `refund-${input.bookingId}-${attemptWindow(10)}` },
      );
    } catch (error) {
      if (error instanceof Stripe.errors.StripeError && error.code === 'charge_already_refunded') {
        return;
      }
      throw toGatewayError(error);
    }
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      throw toGatewayError(error);
    }
  }
}
