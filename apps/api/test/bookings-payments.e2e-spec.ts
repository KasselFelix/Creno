import type { INestApplication } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bookings, payments } from '@creno/db';
import {
  apiErrorSchema,
  type Booking,
  bookingDetailSchema,
  bookingListSchema,
  CHECKOUT_MINUTES,
  checkoutResponseSchema,
  HOLD_MINUTES,
  MAX_FREE_UPCOMING_BOOKINGS,
  type Resource,
  refundAmountChangedDetailsSchema,
  slotsResponseSchema,
} from '@creno/shared';
import { PaymentsGatewayError } from '../src/payments/payments-gateway.js';
import {
  createProviderWithResource,
  createTestApp,
  dbOf,
  everyDay,
  fakePaymentsGateway,
  instantIn,
  localDateIn,
  paidSession,
  postStripeEvent,
  registerAs,
  resetDatabase,
  resetPaymentsGateway,
  RESOURCE_INPUT,
  sessionIdOf,
  WEB_ORIGIN,
} from './app.js';

const DAY = 7;
const MINUTE = 60_000;

describe('bookings : paiement, liste, annulation', () => {
  let app: INestApplication;
  let provider: Awaited<ReturnType<typeof createProviderWithResource>>;
  let resource: Resource;
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

  async function hold(agent: request.Agent, time = '10:00', day = DAY, resourceId = resource.id) {
    const res = await agent
      .post('/v1/bookings')
      .send({ resourceId, start: instantIn(day, time).toISOString() })
      .expect(201);
    return res.body as Booking;
  }
  const checkout = (agent: request.Agent, id: string) => agent.post(`/v1/bookings/${id}/checkout`);
  const cancel = (agent: request.Agent, id: string) => agent.post(`/v1/bookings/${id}/cancel`);
  /** Annulation par le client, avec le montant qu'on lui a annoncé (comme le fait le front). */
  const cancelExpecting = (agent: request.Agent, id: string, expectedRefundCents: number) =>
    cancel(agent, id).send({ expectedRefundCents });
  /** Place le créneau de la réservation `hours` heures après maintenant (négatif : commencé). */
  const startsIn = (id: string, hours: number) =>
    db()
      .update(bookings)
      .set({
        during: sql`tstzrange(now() + make_interval(hours => ${hours}), now() + make_interval(hours => ${hours + 2}), '[)')`,
      })
      .where(eq(bookings.id, id));

  /** Hold payé : la confirmation passe par le webhook, comme en production. */
  async function confirmedBooking(agent: request.Agent, time = '10:00', day = DAY) {
    const booking = await hold(agent, time, day);
    await checkout(agent, booking.id).expect(200);
    await postStripeEvent(app, 'checkout.session.completed', paidSession(booking)).expect(200);
    return booking;
  }
  const rowOf = async (id: string) => {
    const [row] = await db().select().from(bookings).where(eq(bookings.id, id));
    return row!;
  };
  const expectCode = (res: request.Response, code: string) =>
    expect(apiErrorSchema.parse(res.body).code).toBe(code);

  describe('POST /v1/bookings/:id/checkout', () => {
    it('crée la session Stripe au prix du booking, avec la commission et le compte du prestataire', async () => {
      const { agent, user } = await registerAs(app, 'customer');
      const booking = await hold(agent);
      const res = await checkout(agent, booking.id)
        .send({ priceCents: 1, feeCents: 0 })
        .expect(200);
      const body = checkoutResponseSchema.parse(res.body);
      expect(body.checkoutUrl).toBe(`https://checkout.stripe.test/pay/${booking.id}`);
      expect(body.booking).toMatchObject({
        id: booking.id,
        status: 'pending',
        checkoutStarted: true,
        paymentStatus: null,
        resourceName: resource.name,
        providerSlug: provider.provider.slug,
        timezone: 'Europe/Paris',
      });

      expect(gateway.createCheckoutSession).toHaveBeenCalledTimes(1);
      const input = gateway.createCheckoutSession.mock.calls[0]![0];
      expect(input).toMatchObject({
        bookingId: booking.id,
        amountCents: 4500,
        feeCents: 450,
        currency: 'EUR',
        destinationAccountId: provider.stripeAccountId,
        customerEmail: user.email,
        successUrl: `${WEB_ORIGIN}/stripe/return?booking=${booking.id}&checkout=success`,
        cancelUrl: `${WEB_ORIGIN}/stripe/return?booking=${booking.id}&checkout=cancelled`,
      });
      // Les conditions d'annulation du créneau, dans le fuseau de la ressource.
      expect(input.cancellationPolicy).toMatch(
        /^Annulation gratuite jusqu'au .+ à 10:00, remboursée à 50 % jusqu'au .+ à 10:00, puis sans remboursement\.$/,
      );

      // Le hold est prolongé jusqu'à la fin de la session Stripe (au moins 30 min).
      const row = await rowOf(booking.id);
      expect(input.expiresAt).toEqual(row.expiresAt);
      const remaining = row.expiresAt!.getTime() - Date.now();
      expect(remaining).toBeGreaterThan(30 * MINUTE);
      expect(remaining).toBeLessThanOrEqual(CHECKOUT_MINUTES * MINUTE);
      expect(row.stripeCheckoutSessionId).toBe(sessionIdOf(booking.id));
      expect(row.status).toBe('pending');
      expect(logged('booking.checkout_started')).toMatchObject([
        { bookingId: booking.id, resumed: false },
      ]);
      expect(logs.join('\n')).not.toContain(user.email);
    });

    it('un second appel reprend la même session, sans prolonger le hold', async () => {
      const { agent } = await registerAs(app, 'customer');
      const booking = await hold(agent);
      const first = checkoutResponseSchema.parse((await checkout(agent, booking.id)).body);
      const expiresAt = (await rowOf(booking.id)).expiresAt;

      const second = checkoutResponseSchema.parse((await checkout(agent, booking.id)).body);
      expect(second.checkoutUrl).toBe(first.checkoutUrl);
      expect((await rowOf(booking.id)).expiresAt).toEqual(expiresAt);
      expect(gateway.createCheckoutSession).toHaveBeenCalledTimes(1);
      expect(gateway.retrieveCheckoutSession).toHaveBeenCalledWith(sessionIdOf(booking.id));
    });

    it('deux appels simultanés → une seule prolongation, la même échéance transmise à Stripe', async () => {
      const { agent } = await registerAs(app, 'customer');
      const booking = await hold(agent);
      const results = await Promise.all([checkout(agent, booking.id), checkout(agent, booking.id)]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      const expiries = gateway.createCheckoutSession.mock.calls.map(([input]) =>
        input.expiresAt.getTime(),
      );
      // Même échéance = même clé d'idempotence chez Stripe = même session.
      expect(new Set(expiries).size).toBe(1);
      expect((await rowOf(booking.id)).expiresAt!.getTime()).toBe(expiries[0]);
    });

    it('503 PAYMENT_PROVIDER_UNAVAILABLE si Stripe échoue : le hold garde son échéance et un nouvel essai réussit', async () => {
      const { agent } = await registerAs(app, 'customer');
      const booking = await hold(agent);
      gateway.createCheckoutSession.mockRejectedValueOnce(new PaymentsGatewayError('network'));

      const res = await checkout(agent, booking.id).expect(503);
      expectCode(res, 'PAYMENT_PROVIDER_UNAVAILABLE');
      const row = await rowOf(booking.id);
      expect(row.expiresAt!.toISOString()).toBe(booking.expiresAt);
      expect(row.checkoutStartedAt).toBeNull();
      expect(row.stripeCheckoutSessionId).toBeNull();
      expect(logged('payment.gateway_failed')).toMatchObject([
        { level: 40, operation: 'checkout', reason: 'network' },
      ]);

      await checkout(agent, booking.id).expect(200);
      expect((await rowOf(booking.id)).checkoutStartedAt).not.toBeNull();
    });

    it('409 BOOKING_NOT_PAYABLE : hold expiré, réservation confirmée ou annulée', async () => {
      const { agent } = await registerAs(app, 'customer');
      const expired = await hold(agent, '09:00');
      await db()
        .update(bookings)
        .set({ expiresAt: sql`now() - interval '1 second'` })
        .where(eq(bookings.id, expired.id));
      expectCode(await checkout(agent, expired.id).expect(409), 'BOOKING_NOT_PAYABLE');

      const confirmed = await confirmedBooking(agent, '10:00');
      expectCode(await checkout(agent, confirmed.id).expect(409), 'BOOKING_NOT_PAYABLE');

      const cancelled = await hold(agent, '11:00');
      await cancel(agent, cancelled.id).expect(200);
      expectCode(await checkout(agent, cancelled.id).expect(409), 'BOOKING_NOT_PAYABLE');
      expect(gateway.createCheckoutSession).toHaveBeenCalledTimes(1);
    });

    it('409 PROVIDER_PAYMENTS_NOT_READY si le compte du prestataire a été désactivé après le hold', async () => {
      const { agent } = await registerAs(app, 'customer');
      const booking = await hold(agent);
      await postStripeEvent(app, 'account.updated', {
        id: provider.stripeAccountId,
        object: 'account',
        capabilities: { transfers: 'inactive' },
        details_submitted: true,
      }).expect(200);
      expectCode(await checkout(agent, booking.id).expect(409), 'PROVIDER_PAYMENTS_NOT_READY');
      expect(gateway.createCheckoutSession).not.toHaveBeenCalled();
    });

    it('ressource gratuite : confirmée directement, sans Stripe ni paiement', async () => {
      const created = await provider.agent
        .post('/v1/resources')
        .send({ ...RESOURCE_INPUT, name: 'Visite', priceCents: 0 })
        .expect(201);
      const freeId = (created.body as Resource).id;
      await provider.agent
        .put(`/v1/resources/${freeId}/availability-rules`)
        .send({ rules: everyDay('09:00', '12:00') })
        .expect(200);
      const { agent } = await registerAs(app, 'customer');
      const booking = await hold(agent, '10:00', DAY, freeId);

      const body = checkoutResponseSchema.parse(
        (await checkout(agent, booking.id).expect(200)).body,
      );
      expect(body.checkoutUrl).toBeNull();
      expect(body.booking).toMatchObject({
        status: 'confirmed',
        paymentStatus: null,
        expiresAt: null,
      });
      expect(gateway.createCheckoutSession).not.toHaveBeenCalled();
      expect(await db().select().from(payments)).toHaveLength(0);

      // Rien à rembourser : le client l'annule jusqu'au début, même à moins de 24 h, sans Stripe.
      await startsIn(booking.id, 2);
      const cancelled = bookingDetailSchema.parse(
        (await cancel(agent, booking.id).expect(200)).body,
      );
      expect(cancelled).toMatchObject({ status: 'cancelled', refundDueCents: null });
      expect(gateway.refund).not.toHaveBeenCalled();
    });

    it(`pas plus de ${MAX_FREE_UPCOMING_BOOKINGS} réservations gratuites à venir par client`, async () => {
      const created = await provider.agent
        .post('/v1/resources')
        .send({ ...RESOURCE_INPUT, name: 'Visite', priceCents: 0 })
        .expect(201);
      const freeId = (created.body as Resource).id;
      await provider.agent
        .put(`/v1/resources/${freeId}/availability-rules`)
        .send({ rules: everyDay('09:00', '18:00') })
        .expect(200);
      const { agent } = await registerAs(app, 'customer');
      for (let hour = 9; hour < 9 + MAX_FREE_UPCOMING_BOOKINGS; hour++) {
        const booking = await hold(agent, `${String(hour).padStart(2, '0')}:00`, DAY, freeId);
        await checkout(agent, booking.id).expect(200);
      }
      const res = await agent
        .post('/v1/bookings')
        .send({ resourceId: freeId, start: instantIn(DAY, '16:00').toISOString() })
        .expect(409);
      expectCode(res, 'HOLD_LIMIT_REACHED');
      // Les ressources payantes ne sont pas concernées.
      await hold(agent, '10:00');
    });

    it('403 sur la réservation d’un autre client ou pour le prestataire, 401 sans session, 404 inconnue', async () => {
      const owner = await registerAs(app, 'customer');
      const intruder = await registerAs(app, 'customer');
      const booking = await hold(owner.agent);
      expectCode(await checkout(intruder.agent, booking.id).expect(403), 'FORBIDDEN_OWNERSHIP');
      expectCode(await checkout(provider.agent, booking.id).expect(403), 'FORBIDDEN_OWNERSHIP');
      await checkout(request.agent(app.getHttpServer()), booking.id).expect(401);
      await checkout(owner.agent, '00000000-0000-4000-8000-000000000000').expect(404);
      await checkout(owner.agent, 'pas-un-uuid').expect(400);
      expect(gateway.createCheckoutSession).not.toHaveBeenCalled();
      expect((await rowOf(booking.id)).checkoutStartedAt).toBeNull();
    });
  });

  describe('GET /v1/bookings et GET /v1/bookings/:id', () => {
    it('ne liste que mes réservations : à venir, puis historique', async () => {
      const me = await registerAs(app, 'customer');
      const other = await registerAs(app, 'customer');
      const confirmed = await confirmedBooking(me.agent, '09:00');
      const pending = await hold(me.agent, '10:00');
      await hold(other.agent, '11:00');
      const cancelled = await hold(me.agent, '09:00', DAY + 1);
      await cancel(me.agent, cancelled.id).expect(200);
      // Panier abandonné (hold expiré sans paiement) : il n'apparaît nulle part.
      const abandoned = await hold(me.agent, '10:00', DAY + 1);
      await db().update(bookings).set({ status: 'expired' }).where(eq(bookings.id, abandoned.id));

      const upcoming = bookingListSchema.parse(
        (await me.agent.get('/v1/bookings').expect(200)).body,
      );
      expect(upcoming.items.map((b) => b.id)).toEqual([confirmed.id, pending.id]);
      expect(upcoming.total).toBe(2);
      expect(upcoming.items[0]).toMatchObject({
        status: 'confirmed',
        paymentStatus: 'succeeded',
        priceCents: 4500,
        providerName: provider.provider.name,
      });
      const serialized = JSON.stringify(upcoming);
      expect(serialized).not.toContain('pi_test_');
      expect(serialized).not.toContain(provider.stripeAccountId!);
      expect(serialized).not.toContain('customerId');

      const past = bookingListSchema.parse(
        (await me.agent.get('/v1/bookings?scope=past').expect(200)).body,
      );
      expect(past.items.map((b) => b.id)).toEqual([cancelled.id]);

      const paged = bookingListSchema.parse(
        (await me.agent.get('/v1/bookings?page=2&pageSize=1').expect(200)).body,
      );
      expect(paged.items.map((b) => b.id)).toEqual([pending.id]);
      expect(paged.total).toBe(2);
      await me.agent.get('/v1/bookings?scope=tout').expect(400);
      await request(app.getHttpServer()).get('/v1/bookings').expect(401);
    });

    // Test obligatoire : IDOR. Connaître l'identifiant d'une réservation ne donne aucun droit.
    it('GET :id → le client et le prestataire propriétaire la voient ; un autre client ou prestataire → 403', async () => {
      const me = await registerAs(app, 'customer');
      const intruder = await registerAs(app, 'customer');
      const otherProvider = await createProviderWithResource(app);
      const booking = await confirmedBooking(me.agent);

      const mine = bookingDetailSchema.parse(
        (await me.agent.get(`/v1/bookings/${booking.id}`).expect(200)).body,
      );
      // Le client et le prestataire annulent jusqu'au début ; le remboursement du client suit les paliers.
      expect(mine.cancellableUntil).toBe(booking.start);
      const theirs = bookingDetailSchema.parse(
        (await provider.agent.get(`/v1/bookings/${booking.id}`).expect(200)).body,
      );
      expect(theirs.cancellableUntil).toBe(booking.start);

      expectCode(
        await intruder.agent.get(`/v1/bookings/${booking.id}`).expect(403),
        'FORBIDDEN_OWNERSHIP',
      );
      expectCode(
        await otherProvider.agent.get(`/v1/bookings/${booking.id}`).expect(403),
        'FORBIDDEN_OWNERSHIP',
      );
      await request(app.getHttpServer()).get(`/v1/bookings/${booking.id}`).expect(401);
      await me.agent.get('/v1/bookings/00000000-0000-4000-8000-000000000000').expect(404);
    });
  });

  describe('POST /v1/bookings/:id/cancel', () => {
    const slots = async () => {
      const date = localDateIn(DAY);
      const res = await request(app.getHttpServer())
        .get(`/v1/resources/${resource.id}/slots?from=${date}&to=${date}`)
        .expect(200);
      return slotsResponseSchema.parse(res.body).days[0]!.slots.map((s) => s.available);
    };

    const refundedEvent = (bookingId: string, amountRefunded: number, full: boolean) =>
      postStripeEvent(app, 'charge.refunded', {
        id: `ch_test_${bookingId}`,
        object: 'charge',
        payment_intent: `pi_test_${bookingId}`,
        amount_refunded: amountRefunded,
        refunded: full,
      }).expect(200);

    it('client, plus de 48 h avant : remboursement intégral, réservation annulée, créneau libéré', async () => {
      const { agent } = await registerAs(app, 'customer');
      const booking = await confirmedBooking(agent);
      expect(await slots()).toEqual([true, false, true]);

      const body = bookingDetailSchema.parse(
        (await cancelExpecting(agent, booking.id, 4500).expect(200)).body,
      );
      // Le statut du paiement ne change que par le webhook `charge.refunded`.
      expect(body).toMatchObject({
        status: 'cancelled',
        paymentStatus: 'succeeded',
        refundDueCents: 4500,
        refundedCents: 0,
      });
      expect(body.cancellableUntil).toBeNull();
      expect(gateway.refund).toHaveBeenCalledTimes(1);
      expect(gateway.refund).toHaveBeenCalledWith({
        paymentIntentId: `pi_test_${booking.id}`,
        bookingId: booking.id,
        amountCents: 4500,
      });
      expect((await rowOf(booking.id)).cancelledAt).toBeInstanceOf(Date);
      expect(await slots()).toEqual([true, true, true]);
      expect(logged('booking.cancelled')).toMatchObject([
        { bookingId: booking.id, by: 'customer', percent: 100, refunded: true },
      ]);

      await refundedEvent(booking.id, 4500, true);
      const after = bookingDetailSchema.parse(
        (await agent.get(`/v1/bookings/${booking.id}`).expect(200)).body,
      );
      expect(after).toMatchObject({ paymentStatus: 'refunded', refundedCents: 4500 });
    });

    it('client, 36 h avant : remboursé à 50 %, le paiement reste `succeeded` après le webhook partiel', async () => {
      const { agent } = await registerAs(app, 'customer');
      const booking = await confirmedBooking(agent);
      await startsIn(booking.id, 36);

      const body = bookingDetailSchema.parse(
        (await cancelExpecting(agent, booking.id, 2250).expect(200)).body,
      );
      expect(body).toMatchObject({ status: 'cancelled', refundDueCents: 2250 });
      expect(gateway.refund).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 2250 }));
      expect(logged('booking.cancelled')).toMatchObject([{ percent: 50, refunded: true }]);

      await refundedEvent(booking.id, 2250, false);
      const after = bookingDetailSchema.parse(
        (await agent.get(`/v1/bookings/${booking.id}`).expect(200)).body,
      );
      expect(after).toMatchObject({
        paymentStatus: 'succeeded',
        refundedCents: 2250,
        refundDueCents: 2250,
      });
    });

    it('client, 12 h avant : annulée sans remboursement, créneau libéré', async () => {
      const { agent } = await registerAs(app, 'customer');
      const booking = await confirmedBooking(agent);
      await startsIn(booking.id, 12);

      const body = bookingDetailSchema.parse(
        (await cancelExpecting(agent, booking.id, 0).expect(200)).body,
      );
      expect(body).toMatchObject({ status: 'cancelled', refundDueCents: 0 });
      // La passerelle est consultée même à 0 % : elle ne crée rien (voir son test unitaire).
      expect(gateway.refund).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 0 }));
      expect(logged('booking.cancelled')).toMatchObject([{ percent: 0, refunded: false }]);
    });

    it('client, créneau commencé → 409 CANCELLATION_NOT_ALLOWED, rien ne change', async () => {
      const { agent } = await registerAs(app, 'customer');
      const booking = await confirmedBooking(agent);
      await startsIn(booking.id, -1);

      const res = await cancelExpecting(agent, booking.id, 0).expect(409);
      expectCode(res, 'CANCELLATION_NOT_ALLOWED');
      expect(apiErrorSchema.parse(res.body).message).toBe('Cette réservation a commencé.');
      expect(gateway.refund).not.toHaveBeenCalled();
      expect((await rowOf(booking.id)).status).toBe('confirmed');
    });

    it('montant annoncé dépassé → 409 REFUND_AMOUNT_CHANGED avec le nouveau montant ; rien ne change', async () => {
      const { agent } = await registerAs(app, 'customer');
      const booking = await confirmedBooking(agent);
      // La fenêtre a annoncé un remboursement intégral, mais le palier à 50 % a commencé depuis.
      await startsIn(booking.id, 36);

      const res = await cancelExpecting(agent, booking.id, 4500).expect(409);
      const error = apiErrorSchema.parse(res.body);
      expect(error.code).toBe('REFUND_AMOUNT_CHANGED');
      expect(refundAmountChangedDetailsSchema.parse(error.details)).toEqual({
        refundDueCents: 2250,
        percent: 50,
      });
      expect(gateway.refund).not.toHaveBeenCalled();
      expect((await rowOf(booking.id)).status).toBe('confirmed');

      await cancelExpecting(agent, booking.id, 2250).expect(200);
      expect((await rowOf(booking.id)).refundDueCents).toBe(2250);
    });

    it('remboursement déjà fait chez Stripe (essai précédent) : c’est son montant qui est dû', async () => {
      const { agent } = await registerAs(app, 'customer');
      const booking = await confirmedBooking(agent);
      await startsIn(booking.id, 36);
      gateway.refund.mockResolvedValueOnce({ refundedCents: 4500 });

      const body = bookingDetailSchema.parse(
        (await cancelExpecting(agent, booking.id, 2250).expect(200)).body,
      );
      expect(body.refundDueCents).toBe(4500);
      expect(logged('payment.refund_already_exists')).toMatchObject([
        { bookingId: booking.id, percent: 50 },
      ]);
    });

    it('prestataire, 12 h avant et sans corps : remboursement intégral (le montant annoncé ne le concerne pas)', async () => {
      const { agent } = await registerAs(app, 'customer');
      const booking = await confirmedBooking(agent);
      const other = await confirmedBooking(agent, '11:00');
      await startsIn(booking.id, 12);

      const body = bookingDetailSchema.parse(
        (await cancel(provider.agent, booking.id).expect(200)).body,
      );
      expect(body).toMatchObject({ status: 'cancelled', refundDueCents: 4500 });
      expect(gateway.refund).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 4500 }));
      expect(logged('booking.cancelled')).toMatchObject([
        { by: 'provider', percent: 100, refunded: true },
      ]);

      await cancelExpecting(provider.agent, other.id, 1).expect(200);
      expect((await rowOf(other.id)).refundDueCents).toBe(4500);
    });

    it('deux annulations simultanées (double clic) : un seul remboursement, la seconde → 409', async () => {
      const { agent } = await registerAs(app, 'customer');
      const booking = await confirmedBooking(agent);
      await startsIn(booking.id, 36);
      // Stripe lent : sans verrou sur la réservation, les deux requêtes rembourseraient chacune.
      gateway.refund.mockImplementation(async ({ amountCents }) => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return { refundedCents: amountCents };
      });

      const statuses = (
        await Promise.all([
          cancelExpecting(agent, booking.id, 2250),
          cancelExpecting(agent, booking.id, 2250),
        ])
      ).map((res) => res.status);
      expect(statuses.sort()).toEqual([200, 409]);
      expect(gateway.refund).toHaveBeenCalledTimes(1);
      expect((await rowOf(booking.id)).refundDueCents).toBe(2250);
    });

    it('le client et le prestataire annulent en même temps : un seul remboursement', async () => {
      const { agent } = await registerAs(app, 'customer');
      const booking = await confirmedBooking(agent);
      await startsIn(booking.id, 36);
      gateway.refund.mockImplementation(async ({ amountCents }) => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return { refundedCents: amountCents };
      });

      const [byCustomer, byProvider] = await Promise.all([
        cancelExpecting(agent, booking.id, 2250),
        cancel(provider.agent, booking.id),
      ]);
      expect([byCustomer.status, byProvider.status].sort()).toEqual([200, 409]);
      expect(gateway.refund).toHaveBeenCalledTimes(1);
      // Le montant dû est celui de l'annulation qui l'a emporté.
      const winner = byCustomer.status === 200 ? 2250 : 4500;
      expect((await rowOf(booking.id)).refundDueCents).toBe(winner);
    });

    it('Stripe très lent : la seconde annulation n’attend pas plus de 3 s le verrou → 409', async () => {
      const { agent } = await registerAs(app, 'customer');
      const booking = await confirmedBooking(agent);
      gateway.refund.mockImplementation(async ({ amountCents }) => {
        await new Promise((resolve) => setTimeout(resolve, 4_000));
        return { refundedCents: amountCents };
      });

      const [first, second] = await Promise.all([
        cancelExpecting(agent, booking.id, 4500),
        new Promise<request.Response>((resolve) => {
          // Part après la première, qui tient alors le verrou pendant son appel à Stripe.
          setTimeout(() => resolve(cancelExpecting(agent, booking.id, 4500)), 200);
        }),
      ]);
      expect(first.status).toBe(200);
      expect(second.status).toBe(409);
      expect(apiErrorSchema.parse(second.body).message).toContain('déjà en cours');
      expect(gateway.refund).toHaveBeenCalledTimes(1);
    }, 15_000);

    it('corps invalide → 400', async () => {
      const { agent } = await registerAs(app, 'customer');
      const booking = await confirmedBooking(agent);
      await cancel(agent, booking.id).send({ expectedRefundCents: -1 }).expect(400);
      await cancel(agent, booking.id).send({ expectedRefundCents: '4500' }).expect(400);
      expect((await rowOf(booking.id)).status).toBe('confirmed');
    });

    it('503 si le remboursement échoue : rien ne change, et un nouvel essai aboutit', async () => {
      const { agent } = await registerAs(app, 'customer');
      const booking = await confirmedBooking(agent);
      gateway.refund.mockRejectedValueOnce(new PaymentsGatewayError('api_error'));

      expectCode(await cancel(agent, booking.id).expect(503), 'PAYMENT_PROVIDER_UNAVAILABLE');
      expect((await rowOf(booking.id)).status).toBe('confirmed');
      expect(await slots()).toEqual([true, false, true]);

      await cancel(agent, booking.id).expect(200);
      expect((await rowOf(booking.id)).status).toBe('cancelled');
    });

    it('hold en attente : annulé sans remboursement, session Stripe fermée, créneau libéré', async () => {
      const { agent } = await registerAs(app, 'customer');
      const booking = await hold(agent);
      await checkout(agent, booking.id).expect(200);

      const body = bookingDetailSchema.parse((await cancel(agent, booking.id).expect(200)).body);
      expect(body).toMatchObject({ status: 'cancelled', expiresAt: null });
      expect(gateway.expireCheckoutSession).toHaveBeenCalledWith(sessionIdOf(booking.id));
      expect(gateway.refund).not.toHaveBeenCalled();
      expect(await slots()).toEqual([true, true, true]);
    });

    it('hold annulé même si la fermeture de la session Stripe échoue', async () => {
      const { agent } = await registerAs(app, 'customer');
      const booking = await hold(agent);
      await checkout(agent, booking.id).expect(200);
      gateway.expireCheckoutSession.mockRejectedValueOnce(new PaymentsGatewayError('network'));
      await cancel(agent, booking.id).expect(200);
      expect((await rowOf(booking.id)).status).toBe('cancelled');
      expect(logged('payment.gateway_failed')).toMatchObject([{ operation: 'expire_session' }]);
    });

    it('409 pour une réservation déjà annulée, passée, ou un hold que le prestataire voudrait annuler', async () => {
      const { agent } = await registerAs(app, 'customer');
      const pending = await hold(agent, '09:00');
      expectCode(await cancel(provider.agent, pending.id).expect(409), 'CANCELLATION_NOT_ALLOWED');

      const booking = await confirmedBooking(agent, '10:00');
      await cancel(agent, booking.id).expect(200);
      expectCode(await cancel(agent, booking.id).expect(409), 'CANCELLATION_NOT_ALLOWED');
      expect(gateway.refund).toHaveBeenCalledTimes(1);

      const past = await confirmedBooking(agent, '11:00');
      await db()
        .update(bookings)
        .set({
          during: sql`tstzrange(now() - interval '2 hours', now() - interval '1 hour', '[)')`,
        })
        .where(eq(bookings.id, past.id));
      expectCode(await cancel(provider.agent, past.id).expect(409), 'CANCELLATION_NOT_ALLOWED');
    });

    it('403 pour un autre client ou un autre prestataire, 401 sans session', async () => {
      const { agent } = await registerAs(app, 'customer');
      const intruder = await registerAs(app, 'customer');
      const otherProvider = await createProviderWithResource(app);
      const booking = await confirmedBooking(agent);

      expectCode(await cancel(intruder.agent, booking.id).expect(403), 'FORBIDDEN_OWNERSHIP');
      expectCode(await cancel(otherProvider.agent, booking.id).expect(403), 'FORBIDDEN_OWNERSHIP');
      await cancel(request.agent(app.getHttpServer()), booking.id).expect(401);
      expect(gateway.refund).not.toHaveBeenCalled();
      expect((await rowOf(booking.id)).status).toBe('confirmed');
    });
  });

  it(`le hold dure ${HOLD_MINUTES} min tant que le paiement n’est pas lancé`, async () => {
    const { agent } = await registerAs(app, 'customer');
    const booking = await hold(agent);
    const detail = bookingDetailSchema.parse(
      (await agent.get(`/v1/bookings/${booking.id}`).expect(200)).body,
    );
    expect(detail).toMatchObject({ checkoutStarted: false, cancellableUntil: booking.expiresAt });
  });
});
