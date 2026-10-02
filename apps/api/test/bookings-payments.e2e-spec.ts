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
  FREE_CANCELLATION_HOURS,
  HOLD_MINUTES,
  MAX_FREE_UPCOMING_BOOKINGS,
  type Resource,
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
      // Le client annule jusqu'à 24 h avant, le prestataire jusqu'au début.
      expect(mine.cancellableUntil).toBe(
        new Date(Date.parse(booking.start) - FREE_CANCELLATION_HOURS * 60 * MINUTE).toISOString(),
      );
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

    it('client, plus de 24 h avant : remboursement demandé, réservation annulée, créneau libéré', async () => {
      const { agent } = await registerAs(app, 'customer');
      const booking = await confirmedBooking(agent);
      expect(await slots()).toEqual([true, false, true]);

      const body = bookingDetailSchema.parse((await cancel(agent, booking.id).expect(200)).body);
      // Le statut du paiement ne change que par le webhook `charge.refunded`.
      expect(body).toMatchObject({ status: 'cancelled', paymentStatus: 'succeeded' });
      expect(body.cancellableUntil).toBeNull();
      expect(gateway.refund).toHaveBeenCalledTimes(1);
      expect(gateway.refund).toHaveBeenCalledWith({
        paymentIntentId: `pi_test_${booking.id}`,
        bookingId: booking.id,
      });
      expect((await rowOf(booking.id)).cancelledAt).toBeInstanceOf(Date);
      expect(await slots()).toEqual([true, true, true]);
      expect(logged('booking.cancelled')).toMatchObject([
        { bookingId: booking.id, by: 'customer', refunded: true },
      ]);

      await postStripeEvent(app, 'charge.refunded', {
        id: 'ch_test_cancel',
        object: 'charge',
        payment_intent: `pi_test_${booking.id}`,
        amount_refunded: 4500,
        refunded: true,
      }).expect(200);
      const after = bookingDetailSchema.parse(
        (await agent.get(`/v1/bookings/${booking.id}`).expect(200)).body,
      );
      expect(after).toMatchObject({ paymentStatus: 'refunded', refundedCents: 4500 });
    });

    it('client, moins de 24 h avant → 409 CANCELLATION_NOT_ALLOWED ; le prestataire, lui, peut annuler et rembourser', async () => {
      const { agent } = await registerAs(app, 'customer');
      const booking = await confirmedBooking(agent);
      // Le créneau commence dans 23 h : la limite du client est dépassée.
      await db()
        .update(bookings)
        .set({
          during: sql`tstzrange(now() + interval '23 hours', now() + interval '24 hours', '[)')`,
        })
        .where(eq(bookings.id, booking.id));

      expectCode(await cancel(agent, booking.id).expect(409), 'CANCELLATION_NOT_ALLOWED');
      expect(gateway.refund).not.toHaveBeenCalled();
      expect((await rowOf(booking.id)).status).toBe('confirmed');

      const body = bookingDetailSchema.parse(
        (await cancel(provider.agent, booking.id).expect(200)).body,
      );
      expect(body.status).toBe('cancelled');
      expect(gateway.refund).toHaveBeenCalledTimes(1);
      expect(logged('booking.cancelled')).toMatchObject([{ by: 'provider', refunded: true }]);
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
