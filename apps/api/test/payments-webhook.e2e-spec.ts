import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bookings, payments, providers, stripeEvents } from '@creno/db';
import {
  apiErrorSchema,
  type Booking,
  publicProviderSchema,
  type Resource,
  slotsResponseSchema,
} from '@creno/shared';
import { PaymentsGatewayError } from '../src/payments/payments-gateway.js';
import {
  createProviderWithResource,
  createTestApp,
  dbOf,
  fakePaymentsGateway,
  instantIn,
  localDateIn,
  paidSession,
  postStripeEvent,
  registerAs,
  resetDatabase,
  resetPaymentsGateway,
  sessionIdOf,
  TEST_WEBHOOK_SECRET,
} from './app.js';

const DAY = 7;

describe('webhook Stripe', () => {
  let app: INestApplication;
  let resource: Resource;
  let provider: Awaited<ReturnType<typeof createProviderWithResource>>;
  const gateway = fakePaymentsGateway();
  const logs: string[] = [];

  beforeAll(async () => {
    app = await createTestApp({ payments: gateway, logs });
  });
  beforeEach(async () => {
    await resetDatabase(app);
    resetPaymentsGateway(gateway);
    logs.length = 0;
    provider = await createProviderWithResource(app);
    resource = provider.resource;
  });
  afterAll(async () => {
    await app.close();
  });

  const db = () => dbOf(app).db;
  const logged = (event: string) =>
    logs
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((l) => l.event === event);

  /** Un client bloque le créneau et lance le paiement, comme le fait le front. */
  async function heldBooking(time = '10:00') {
    const customer = await registerAs(app, 'customer');
    const res = await customer.agent
      .post('/v1/bookings')
      .send({ resourceId: resource.id, start: instantIn(DAY, time).toISOString() })
      .expect(201);
    const booking = res.body as Booking;
    await customer.agent.post(`/v1/bookings/${booking.id}/checkout`).expect(200);
    return { ...customer, booking };
  }

  const statusOf = async (bookingId: string) => {
    const [row] = await db()
      .select({ status: bookings.status, expiresAt: bookings.expiresAt })
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    return row!;
  };
  const paymentRows = () => db().select().from(payments);
  const eventRows = () => db().select().from(stripeEvents);
  const availability = async () => {
    const date = localDateIn(DAY);
    const res = await request(app.getHttpServer())
      .get(`/v1/resources/${resource.id}/slots?from=${date}&to=${date}`)
      .expect(200);
    return slotsResponseSchema.parse(res.body).days[0]!.slots.map((s) => s.available);
  };

  describe('signature', () => {
    // Test obligatoire : un appel qui ne vient pas de Stripe ne doit rien écrire.
    it('400 INVALID_WEBHOOK_SIGNATURE si la signature est faite avec un autre secret', async () => {
      const { booking } = await heldBooking();
      const wrongSecret = ['whsec', randomBytes(24).toString('hex')].join('_');
      const res = await postStripeEvent(app, 'checkout.session.completed', paidSession(booking), {
        secret: wrongSecret,
      }).expect(400);
      expect(apiErrorSchema.parse(res.body).code).toBe('INVALID_WEBHOOK_SIGNATURE');
      expect(await eventRows()).toHaveLength(0);
      expect(await paymentRows()).toHaveLength(0);
      expect((await statusOf(booking.id)).status).toBe('pending');
      expect(logged('stripe.webhook_invalid_signature')).toHaveLength(1);
    });

    it('400 sans en-tête de signature, ou si le corps a été modifié après signature', async () => {
      const { booking } = await heldBooking();
      const payload = JSON.stringify({
        id: 'evt_test_tampered',
        object: 'event',
        type: 'checkout.session.completed',
        data: { object: paidSession(booking) },
      });
      await request(app.getHttpServer())
        .post('/v1/payments/webhook')
        .set('content-type', 'application/json')
        .send(payload)
        .expect(400);

      const signed = postStripeEvent(app, 'checkout.session.completed', paidSession(booking));
      const signature = (signed as unknown as { get(name: string): string }).get(
        'stripe-signature',
      );
      await signed.expect(200);
      // Même signature, autre corps : refusé.
      await request(app.getHttpServer())
        .post('/v1/payments/webhook')
        .set('content-type', 'application/json')
        .set('stripe-signature', signature)
        .send(payload)
        .expect(400);
      expect(await eventRows()).toHaveLength(1);
    });
  });

  describe('checkout.session.completed', () => {
    it('confirme la réservation et enregistre le paiement', async () => {
      const { booking } = await heldBooking();
      await postStripeEvent(app, 'checkout.session.completed', paidSession(booking)).expect(200);

      expect(await statusOf(booking.id)).toEqual({ status: 'confirmed', expiresAt: null });
      expect(await paymentRows()).toMatchObject([
        {
          bookingId: booking.id,
          stripePaymentIntentId: `pi_test_${booking.id}`,
          amountCents: 4500,
          feeCents: 450,
          currency: 'EUR',
          status: 'succeeded',
          refundedCents: 0,
        },
      ]);
      expect(await availability()).toEqual([true, false, true]);
      expect(logged('booking.confirmed')).toMatchObject([{ bookingId: booking.id, paid: true }]);
      expect(gateway.refund).not.toHaveBeenCalled();
    });

    // Test obligatoire : Stripe renvoie un événement tant qu'il n'a pas reçu de 200.
    it('événement rejoué → 200, toujours un seul paiement', async () => {
      const { booking } = await heldBooking();
      const id = 'evt_test_replayed';
      await postStripeEvent(app, 'checkout.session.completed', paidSession(booking), {
        id,
      }).expect(200);
      await postStripeEvent(app, 'checkout.session.completed', paidSession(booking), {
        id,
      }).expect(200);

      expect(await paymentRows()).toHaveLength(1);
      expect(await eventRows()).toHaveLength(1);
      expect(logged('stripe.webhook_duplicate')).toHaveLength(1);
    });

    it('deux événements différents pour la même session → un seul paiement', async () => {
      const { booking } = await heldBooking();
      await postStripeEvent(app, 'checkout.session.completed', paidSession(booking)).expect(200);
      await postStripeEvent(app, 'checkout.session.completed', paidSession(booking)).expect(200);
      expect(await paymentRows()).toHaveLength(1);
      expect(await eventRows()).toHaveLength(2);
      expect((await statusOf(booking.id)).status).toBe('confirmed');
    });

    it('le même événement reçu deux fois en même temps → un seul paiement', async () => {
      const { booking } = await heldBooking();
      const id = 'evt_test_parallel';
      const results = await Promise.all([
        postStripeEvent(app, 'checkout.session.completed', paidSession(booking), { id }),
        postStripeEvent(app, 'checkout.session.completed', paidSession(booking), { id }),
      ]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      expect(await paymentRows()).toHaveLength(1);
    });

    it('hold dont l’échéance est passée mais que personne n’a repris → confirmé', async () => {
      const { booking } = await heldBooking();
      await db()
        .update(bookings)
        .set({ expiresAt: sql`now() - interval '1 minute'` })
        .where(eq(bookings.id, booking.id));
      await postStripeEvent(app, 'checkout.session.completed', paidSession(booking)).expect(200);
      expect((await statusOf(booking.id)).status).toBe('confirmed');
      expect(gateway.refund).not.toHaveBeenCalled();
    });

    it('réservation déjà passée à expired, créneau toujours libre → confirmée', async () => {
      const { booking } = await heldBooking();
      await db().update(bookings).set({ status: 'expired' }).where(eq(bookings.id, booking.id));
      await postStripeEvent(app, 'checkout.session.completed', paidSession(booking)).expect(200);
      expect((await statusOf(booking.id)).status).toBe('confirmed');
      expect(await availability()).toEqual([true, false, true]);
      expect(gateway.refund).not.toHaveBeenCalled();
    });

    it('paiement tardif, créneau repris par un autre client → remboursé, l’autre réservation intacte', async () => {
      const late = await heldBooking();
      // Le hold expire, puis un second client prend le créneau (ce qui passe le premier à expired).
      await db()
        .update(bookings)
        .set({ expiresAt: sql`now() - interval '1 minute'` })
        .where(eq(bookings.id, late.booking.id));
      const winner = await heldBooking();

      await postStripeEvent(app, 'checkout.session.completed', paidSession(late.booking)).expect(
        200,
      );

      expect(gateway.refund).toHaveBeenCalledTimes(1);
      expect(gateway.refund).toHaveBeenCalledWith({
        paymentIntentId: `pi_test_${late.booking.id}`,
        bookingId: late.booking.id,
      });
      expect((await statusOf(late.booking.id)).status).toBe('expired');
      expect((await statusOf(winner.booking.id)).status).toBe('pending');
      // Le paiement reçu est tracé ; il passera à `refunded` avec l'événement `charge.refunded`.
      expect(await paymentRows()).toMatchObject([
        { bookingId: late.booking.id, status: 'succeeded' },
      ]);
      expect(logged('payment.late_refund')).toMatchObject([
        { level: 40, bookingId: late.booking.id, reason: 'slot_taken' },
      ]);
    });

    it('paiement tardif sur un créneau repris, remboursement en échec → rien d’enregistré, puis traité au renvoi', async () => {
      const late = await heldBooking();
      await db()
        .update(bookings)
        .set({ expiresAt: sql`now() - interval '1 minute'` })
        .where(eq(bookings.id, late.booking.id));
      const winner = await heldBooking();
      gateway.refund.mockRejectedValueOnce(new PaymentsGatewayError('api_error'));
      const id = 'evt_test_late_retry';

      await postStripeEvent(app, 'checkout.session.completed', paidSession(late.booking), {
        id,
      }).expect(500);
      expect(await eventRows()).toHaveLength(0);
      expect(await paymentRows()).toHaveLength(0);

      await postStripeEvent(app, 'checkout.session.completed', paidSession(late.booking), {
        id,
      }).expect(200);
      expect(await paymentRows()).toMatchObject([{ bookingId: late.booking.id }]);
      expect((await statusOf(late.booking.id)).status).toBe('expired');
      expect((await statusOf(winner.booking.id)).status).toBe('pending');
    });

    it('réservation annulée par le client avant l’arrivée du paiement → remboursée', async () => {
      const { agent, booking } = await heldBooking();
      await agent.post(`/v1/bookings/${booking.id}/cancel`).expect(200);
      await postStripeEvent(app, 'checkout.session.completed', paidSession(booking)).expect(200);
      expect(gateway.refund).toHaveBeenCalledTimes(1);
      expect((await statusOf(booking.id)).status).toBe('cancelled');
      expect(logged('payment.late_refund')).toMatchObject([{ reason: 'booking_cancelled' }]);
    });

    it('si le remboursement tardif échoue, rien n’est enregistré et le renvoi de Stripe est traité', async () => {
      const { agent, booking } = await heldBooking();
      await agent.post(`/v1/bookings/${booking.id}/cancel`).expect(200);
      gateway.refund.mockRejectedValueOnce(new PaymentsGatewayError('network'));
      const id = 'evt_test_retried';

      await postStripeEvent(app, 'checkout.session.completed', paidSession(booking), {
        id,
      }).expect(500);
      expect(await eventRows()).toHaveLength(0);
      expect(await paymentRows()).toHaveLength(0);

      await postStripeEvent(app, 'checkout.session.completed', paidSession(booking), {
        id,
      }).expect(200);
      expect(await eventRows()).toHaveLength(1);
      expect(await paymentRows()).toHaveLength(1);
      expect(gateway.refund).toHaveBeenCalledTimes(2);
    });

    it('montant différent du prix de la réservation → pas de confirmation, log error', async () => {
      const { booking } = await heldBooking();
      await postStripeEvent(
        app,
        'checkout.session.completed',
        paidSession(booking, { amount_total: 100 }),
      ).expect(200);
      expect((await statusOf(booking.id)).status).toBe('pending');
      expect(await paymentRows()).toHaveLength(0);
      expect(logged('payment.amount_mismatch')).toMatchObject([
        { level: 50, bookingId: booking.id },
      ]);
    });

    it('un événement de paiement venu d’un compte connecté ne confirme rien', async () => {
      const { booking } = await heldBooking();
      await postStripeEvent(app, 'checkout.session.completed', paidSession(booking), {
        account: provider.stripeAccountId!,
      }).expect(200);
      expect((await statusOf(booking.id)).status).toBe('pending');
      expect(await paymentRows()).toHaveLength(0);
      expect(logged('stripe.webhook_unmatched')).toMatchObject([{ reason: 'connect_event' }]);
    });

    it.each([
      ['réservation inconnue', { metadata: { bookingId: '00000000-0000-4000-8000-000000000000' } }],
      ['sans bookingId (autre application sur le même compte Stripe)', { metadata: {} }],
      ['bookingId mal formé', { metadata: { bookingId: "1' OR '1'='1" } }],
      ['autre session que celle de la réservation', { id: 'cs_test_autre' }],
      ['session non payée', { payment_status: 'unpaid' }],
      ['référence client d’une autre réservation', { client_reference_id: 'autre' }],
    ])('ignore sans erreur : %s', async (_label, overrides) => {
      const { booking } = await heldBooking();
      await postStripeEvent(
        app,
        'checkout.session.completed',
        paidSession(booking, overrides),
      ).expect(200);
      expect((await statusOf(booking.id)).status).toBe('pending');
      expect(await paymentRows()).toHaveLength(0);
      expect(logged('stripe.webhook_unmatched')).toHaveLength(1);
    });
  });

  describe('checkout.session.expired', () => {
    it('libère le hold : la réservation passe à expired et le créneau redevient libre', async () => {
      const { booking } = await heldBooking();
      expect(await availability()).toEqual([true, false, true]);
      await postStripeEvent(app, 'checkout.session.expired', {
        id: sessionIdOf(booking.id),
        object: 'checkout.session',
        client_reference_id: booking.id,
        payment_status: 'unpaid',
        metadata: { bookingId: booking.id },
      }).expect(200);
      expect((await statusOf(booking.id)).status).toBe('expired');
      expect(await availability()).toEqual([true, true, true]);
      expect(logged('booking.checkout_abandoned')).toMatchObject([{ bookingId: booking.id }]);
    });

    it('ne touche pas une réservation déjà confirmée', async () => {
      const { booking } = await heldBooking();
      await postStripeEvent(app, 'checkout.session.completed', paidSession(booking)).expect(200);
      await postStripeEvent(app, 'checkout.session.expired', {
        id: sessionIdOf(booking.id),
        object: 'checkout.session',
        client_reference_id: booking.id,
        payment_status: 'paid',
        metadata: { bookingId: booking.id },
      }).expect(200);
      expect((await statusOf(booking.id)).status).toBe('confirmed');
    });
  });

  describe('charge.refunded', () => {
    const refundedCharge = (bookingId: string, overrides: Record<string, unknown> = {}) => ({
      id: 'ch_test_1',
      object: 'charge',
      payment_intent: `pi_test_${bookingId}`,
      amount: 4500,
      amount_refunded: 4500,
      refunded: true,
      ...overrides,
    });

    it('marque le paiement remboursé', async () => {
      const { booking } = await heldBooking();
      await postStripeEvent(app, 'checkout.session.completed', paidSession(booking)).expect(200);
      await postStripeEvent(app, 'charge.refunded', refundedCharge(booking.id)).expect(200);
      const [payment] = await paymentRows();
      expect(payment).toMatchObject({ status: 'refunded', refundedCents: 4500 });
      expect(payment!.refundedAt).toBeInstanceOf(Date);
      // Remboursement fait hors de Creno (tableau de bord Stripe) : la réservation reste confirmée.
      expect((await statusOf(booking.id)).status).toBe('confirmed');
      expect(logged('payment.refunded')).toMatchObject([
        { bookingId: booking.id, full: true, bookingStatus: 'confirmed' },
      ]);
    });

    it('remboursement partiel : montant reporté, statut inchangé', async () => {
      const { booking } = await heldBooking();
      await postStripeEvent(app, 'checkout.session.completed', paidSession(booking)).expect(200);
      await postStripeEvent(
        app,
        'charge.refunded',
        refundedCharge(booking.id, { amount_refunded: 1000, refunded: false }),
      ).expect(200);
      expect((await paymentRows())[0]).toMatchObject({ status: 'succeeded', refundedCents: 1000 });
    });

    it('remboursement reçu avant l’enregistrement du paiement → 503 sans rien enregistrer, puis traité au renvoi', async () => {
      const { booking } = await heldBooking();
      const early = refundedCharge(booking.id, { metadata: { bookingId: booking.id } });
      const id = 'evt_test_early_refund';

      await postStripeEvent(app, 'charge.refunded', early, { id }).expect(503);
      expect(await eventRows()).toHaveLength(0);
      expect(logged('stripe.webhook_retry_requested')).toHaveLength(1);

      await postStripeEvent(app, 'checkout.session.completed', paidSession(booking)).expect(200);
      await postStripeEvent(app, 'charge.refunded', early, { id }).expect(200);
      expect((await paymentRows())[0]).toMatchObject({ status: 'refunded', refundedCents: 4500 });
    });

    it('paiement inconnu → 200, rien ne change', async () => {
      await postStripeEvent(app, 'charge.refunded', refundedCharge('inconnu')).expect(200);
      expect(logged('stripe.webhook_unmatched')).toHaveLength(1);
    });
  });

  describe('account.updated', () => {
    const account = (id: string, enabled: boolean) => ({
      id,
      object: 'account',
      capabilities: { transfers: enabled ? 'active' : 'inactive' },
      details_submitted: true,
    });

    it('active puis désactive les paiements du prestataire, sans exposer son compte', async () => {
      const pending = await createProviderWithResource(app, {}, { payments: false });
      const accountId = 'acct_test_pending';
      await db()
        .update(providers)
        .set({ stripeAccountId: accountId })
        .where(eq(providers.id, pending.provider.id));
      const publicPage = async () => {
        const res = await request(app.getHttpServer())
          .get(`/v1/providers/${pending.provider.slug}`)
          .expect(200);
        expect(JSON.stringify(res.body)).not.toContain(accountId);
        return publicProviderSchema.parse(res.body);
      };
      expect((await publicPage()).onlinePayment).toBe(false);

      await postStripeEvent(app, 'account.updated', account(accountId, true)).expect(200);
      expect((await publicPage()).onlinePayment).toBe(true);
      expect(logged('provider.payments_status_changed')).toMatchObject([
        { providerId: pending.provider.id, chargesEnabled: true },
      ]);

      await postStripeEvent(app, 'account.updated', account(accountId, false)).expect(200);
      expect((await publicPage()).onlinePayment).toBe(false);
    });

    it('compte inconnu → 200', async () => {
      await postStripeEvent(app, 'account.updated', account('acct_inconnu', true)).expect(200);
    });
  });

  it('un type d’événement non géré est enregistré et acquitté', async () => {
    await postStripeEvent(app, 'customer.created', { id: 'cus_test', object: 'customer' }).expect(
      200,
    );
    expect(await eventRows()).toMatchObject([{ type: 'customer.created' }]);
  });

  it('les logs ne contiennent ni email, ni secret, ni corps d’événement', async () => {
    const { user, booking } = await heldBooking();
    await postStripeEvent(app, 'checkout.session.completed', paidSession(booking)).expect(200);
    const all = logs.join('\n');
    expect(all).not.toContain(user.email);
    expect(all).not.toContain(TEST_WEBHOOK_SECRET);
    expect(all).not.toContain('payment_intent');
    expect(logged('stripe.webhook_received')).toMatchObject([
      { type: 'checkout.session.completed', outcome: 'confirmed' },
    ]);
  });
});
