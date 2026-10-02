import Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import { PaymentsGatewayError } from './payments-gateway.js';
import { StripePaymentsGateway, toGatewayError } from './stripe-payments-gateway.js';

/** Faux client Stripe : seules les méthodes appelées par l'adapter existent. */
function fakeStripe() {
  const client = {
    accounts: { retrieve: vi.fn() },
    v2: { core: { accounts: { create: vi.fn() }, accountLinks: { create: vi.fn() } } },
    checkout: { sessions: { create: vi.fn(), retrieve: vi.fn(), expire: vi.fn() } },
    refunds: { create: vi.fn() },
  };
  return { client, gateway: new StripePaymentsGateway('', client as unknown as Stripe) };
}

const BOOKING_ID = '3f0c2f0e-6a52-4d53-9a5e-1f7f6f0c9a11';
const EXPIRES_AT = new Date('2030-01-07T10:31:00Z');

const checkoutInput = {
  bookingId: BOOKING_ID,
  amountCents: 4500,
  feeCents: 450,
  currency: 'EUR',
  destinationAccountId: 'acct_test_1',
  productName: 'Studio A — Studio Lumière',
  description: 'lundi 7 janvier 2030 à 10:00',
  customerEmail: 'client@test.dev',
  expiresAt: EXPIRES_AT,
  successUrl: 'http://localhost:3000/ok',
  cancelUrl: 'http://localhost:3000/ko',
};

describe('StripePaymentsGateway', () => {
  it('crée une session Checkout en destination charge, bornée par l’échéance du hold', async () => {
    const { client, gateway } = fakeStripe();
    client.checkout.sessions.create.mockResolvedValue({ id: 'cs_test_1', url: 'https://pay' });

    expect(await gateway.createCheckoutSession(checkoutInput)).toEqual({
      sessionId: 'cs_test_1',
      url: 'https://pay',
    });
    const [params, options] = client.checkout.sessions.create.mock.calls[0]!;
    expect(params).toMatchObject({
      mode: 'payment',
      allowed_payment_method_types: ['card'],
      line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: 4500 } }],
      payment_intent_data: {
        application_fee_amount: 450,
        transfer_data: { destination: 'acct_test_1' },
        metadata: { bookingId: BOOKING_ID, feeCents: '450' },
      },
      metadata: { bookingId: BOOKING_ID, feeCents: '450' },
      expires_at: EXPIRES_AT.getTime() / 1000,
    });
    expect(options).toEqual({
      idempotencyKey: `checkout-${BOOKING_ID}-${EXPIRES_AT.getTime() / 1000}`,
    });
  });

  it('ne renvoie l’adresse d’une session que si elle est encore ouverte', async () => {
    const { client, gateway } = fakeStripe();
    client.checkout.sessions.retrieve.mockResolvedValueOnce({
      id: 'cs_test_1',
      url: 'https://pay',
      status: 'open',
    });
    expect((await gateway.retrieveCheckoutSession('cs_test_1')).url).toBe('https://pay');
    client.checkout.sessions.retrieve.mockResolvedValueOnce({
      id: 'cs_test_1',
      url: null,
      status: 'complete',
    });
    expect((await gateway.retrieveCheckoutSession('cs_test_1')).url).toBeNull();
  });

  it('crée un compte destinataire (Accounts v2) : tableau de bord Express, plateforme responsable', async () => {
    const { client, gateway } = fakeStripe();
    client.v2.core.accounts.create.mockResolvedValue({ id: 'acct_test_1' });
    const input = { providerId: 'p1', contactEmail: 'pro@test.dev', displayName: 'Studio' };
    expect(await gateway.createConnectAccount(input)).toEqual({ accountId: 'acct_test_1' });
    const [params, options] = client.v2.core.accounts.create.mock.calls[0]!;
    expect(params).toEqual({
      contact_email: 'pro@test.dev',
      display_name: 'Studio',
      dashboard: 'express',
      identity: { country: 'fr' },
      defaults: {
        responsibilities: { fees_collector: 'application', losses_collector: 'application' },
      },
      configuration: {
        recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } },
      },
      metadata: { providerId: 'p1' },
    });
    // Clé par prestataire et par minute : un double clic rend le même compte, une erreur n'est
    // pas rejouée pendant 24 h.
    expect((options as { idempotencyKey: string }).idempotencyKey).toMatch(/^account-p1-\d+$/);
  });

  it('demande un lien d’onboarding pour le compte', async () => {
    const { client, gateway } = fakeStripe();
    client.v2.core.accountLinks.create.mockResolvedValue({ url: 'https://connect.stripe.test/x' });
    const link = await gateway.createAccountLink({
      accountId: 'acct_test_1',
      refreshUrl: 'http://localhost:3000/r',
      returnUrl: 'http://localhost:3000/ok',
    });
    expect(link).toEqual({ url: 'https://connect.stripe.test/x' });
    expect(client.v2.core.accountLinks.create).toHaveBeenCalledWith({
      account: 'acct_test_1',
      use_case: {
        type: 'account_onboarding',
        account_onboarding: {
          refresh_url: 'http://localhost:3000/r',
          return_url: 'http://localhost:3000/ok',
        },
      },
    });
  });

  it('un compte est actif quand il peut recevoir des transferts, pas quand il encaisse lui-même', async () => {
    const { client, gateway } = fakeStripe();
    client.accounts.retrieve.mockResolvedValueOnce({
      charges_enabled: false,
      details_submitted: true,
      capabilities: { transfers: 'active' },
    });
    expect(await gateway.retrieveAccount('acct_test_1')).toEqual({
      chargesEnabled: true,
      detailsSubmitted: true,
    });
    client.accounts.retrieve.mockResolvedValueOnce({
      charges_enabled: false,
      details_submitted: false,
      capabilities: { transfers: 'inactive' },
    });
    expect((await gateway.retrieveAccount('acct_test_1')).chargesEnabled).toBe(false);
  });

  it('rembourse en reprenant le versement et la commission, avec une clé d’idempotence', async () => {
    const { client, gateway } = fakeStripe();
    client.refunds.create.mockResolvedValue({ id: 're_test_1' });
    await gateway.refund({ paymentIntentId: 'pi_test_1', bookingId: BOOKING_ID });
    const [params, options] = client.refunds.create.mock.calls[0]!;
    expect(params).toEqual({
      payment_intent: 'pi_test_1',
      reverse_transfer: true,
      refund_application_fee: true,
      metadata: { bookingId: BOOKING_ID },
    });
    expect((options as { idempotencyKey: string }).idempotencyKey).toMatch(
      new RegExp(`^refund-${BOOKING_ID}-\\d+$`),
    );
  });

  it('un paiement déjà remboursé n’est pas une erreur', async () => {
    const { client, gateway } = fakeStripe();
    client.refunds.create.mockRejectedValue(
      new Stripe.errors.StripeInvalidRequestError({
        type: 'invalid_request_error',
        code: 'charge_already_refunded',
        message: 'déjà remboursé',
      }),
    );
    await expect(
      gateway.refund({ paymentIntentId: 'pi_test_1', bookingId: BOOKING_ID }),
    ).resolves.toBeUndefined();
  });

  it('expirer une session déjà terminée ne lève pas d’erreur ; une panne réseau, si', async () => {
    const { client, gateway } = fakeStripe();
    client.checkout.sessions.expire.mockRejectedValueOnce(
      new Stripe.errors.StripeInvalidRequestError({
        type: 'invalid_request_error',
        message: 'session terminée',
      }),
    );
    await expect(gateway.expireCheckoutSession('cs_test_1')).resolves.toBeUndefined();
    client.checkout.sessions.expire.mockRejectedValueOnce(
      new Stripe.errors.StripeConnectionError({ type: 'api_error', message: 'coupure' }),
    );
    await expect(gateway.expireCheckoutSession('cs_test_1')).rejects.toMatchObject({
      reason: 'network',
    });
  });
});

describe('toGatewayError', () => {
  it.each([
    [new Stripe.errors.StripeConnectionError({ type: 'api_error', message: 'x' }), 'network'],
    [
      new Stripe.errors.StripeRateLimitError({ type: 'rate_limit_error', message: 'x' }),
      'rate_limited',
    ],
    [
      new Stripe.errors.StripeAuthenticationError({ type: 'authentication_error', message: 'x' }),
      'authentication',
    ],
    [
      new Stripe.errors.StripeInvalidRequestError({ type: 'invalid_request_error', message: 'x' }),
      'invalid_request',
    ],
    [new Stripe.errors.StripeAPIError({ type: 'api_error', message: 'x' }), 'api_error'],
    [new Error('socket hang up'), 'network'],
  ])('%s → %s', (error, reason) => {
    expect(toGatewayError(error)).toMatchObject({ reason });
  });

  it('garde le code d’erreur de Stripe, jamais son message (il peut citer un email)', () => {
    const error = toGatewayError(
      new Stripe.errors.StripeInvalidRequestError({
        type: 'invalid_request_error',
        code: 'account_invalid',
        message: 'No such account for client@test.dev',
      }),
    );
    expect(error).toBeInstanceOf(PaymentsGatewayError);
    expect(error.code).toBe('account_invalid');
    expect(error.message).not.toContain('client@test.dev');
  });
});
