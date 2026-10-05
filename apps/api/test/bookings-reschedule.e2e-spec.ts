import type { INestApplication } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bookings, notifications } from '@creno/db';
import {
  apiErrorSchema,
  type Booking,
  bookingDetailSchema,
  type ErrorCode,
  providerBookingSchema,
  REMINDER_LEAD_HOURS,
  type Resource,
} from '@creno/shared';
import { SEND_QUEUE } from '../src/notifications/notifications.queues.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import {
  createProviderWithResource,
  createTestApp,
  dbOf,
  fakeEmailGateway,
  fakePaymentsGateway,
  instantIn,
  localDateIn,
  paidSession,
  postStripeEvent,
  registerAs,
  resetDatabase,
  resetPaymentsGateway,
  runJobs,
} from './app.js';

const DAY = 7;
const HOUR_MS = 3_600_000;

describe('bookings : déplacement par le prestataire', () => {
  let app: INestApplication;
  let provider: Awaited<ReturnType<typeof createProviderWithResource>>;
  let resource: Resource;
  const gateway = fakePaymentsGateway();
  const email = fakeEmailGateway();
  const logs: string[] = [];

  beforeAll(async () => {
    app = await createTestApp({ payments: gateway, email, logs });
  });
  beforeEach(async () => {
    await resetDatabase(app);
    resetPaymentsGateway(gateway);
    email.send.mockClear();
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
  const expectCode = (res: request.Response, code: ErrorCode) =>
    expect(apiErrorSchema.parse(res.body).code).toBe(code);
  const rowOf = async (id: string) =>
    (await db().select().from(bookings).where(eq(bookings.id, id)))[0]!;
  const notificationsOf = (bookingId: string) =>
    db()
      .select()
      .from(notifications)
      .where(eq(notifications.bookingId, bookingId))
      .orderBy(
        asc(notifications.bookingRevision),
        asc(notifications.kind),
        asc(notifications.channel),
      );
  const subjects = () => email.send.mock.calls.map(([message]) => message.subject);

  async function hold(agent: request.Agent, start: Date) {
    const res = await agent
      .post('/v1/bookings')
      .send({ resourceId: resource.id, start: start.toISOString() })
      .expect(201);
    return res.body as Booking;
  }

  /** Hold payé puis confirmé par le webhook, comme en production. */
  async function confirmedBooking(agent: request.Agent, start = instantIn(DAY, '10:00')) {
    const booking = await hold(agent, start);
    await agent.post(`/v1/bookings/${booking.id}/checkout`).expect(200);
    await postStripeEvent(app, 'checkout.session.completed', paidSession(booking)).expect(200);
    return booking;
  }

  const reschedule = (agent: request.Agent, id: string, start: Date) =>
    agent.post(`/v1/bookings/${id}/reschedule`).send({ start: start.toISOString() });

  describe('cas nominal', () => {
    it('déplace la réservation, prévient le client et reprogramme le rappel', async () => {
      const { agent, user } = await registerAs(app, 'customer');
      const booking = await confirmedBooking(agent);
      const target = instantIn(DAY + 1, '11:00');

      const res = await reschedule(provider.agent, booking.id, target).expect(200);

      const body = providerBookingSchema.parse(res.body);
      expect(body).toMatchObject({
        id: booking.id,
        start: target.toISOString(),
        end: new Date(target.getTime() + HOUR_MS).toISOString(),
        status: 'confirmed',
        customer: { fullName: expect.any(String), email: user.email },
        paymentStatus: 'succeeded',
        reschedulable: true,
      });
      expect(body.rescheduledAt).not.toBeNull();
      const row = await rowOf(booking.id);
      expect(row.rescheduleCount).toBe(1);
      expect(row.rescheduledAt).not.toBeNull();

      // Le rappel de l'ancien horaire est fermé, de nouvelles lignes visent le nouvel horaire.
      expect(await notificationsOf(booking.id)).toMatchObject([
        { kind: 'booking_confirmed', bookingRevision: 0, status: 'pending' },
        { kind: 'booking_received', bookingRevision: 0, status: 'pending' },
        {
          kind: 'booking_reminder',
          bookingRevision: 0,
          status: 'skipped',
          reason: 'rescheduled',
        },
        { kind: 'booking_reminder', bookingRevision: 1, status: 'scheduled' },
        { kind: 'booking_moved', bookingRevision: 1, status: 'pending', recipientId: user.id },
      ]);
      const reminder = (await notificationsOf(booking.id))[3]!;
      expect(reminder.scheduledFor.getTime()).toBe(
        target.getTime() - REMINDER_LEAD_HOURS * HOUR_MS,
      );

      await runJobs(app, SEND_QUEUE);
      expect(subjects()).toContain('Réservation déplacée : Studio A chez Studio Lumière');
      const moved = email.send.mock.calls
        .map(([message]) => message)
        .find((message) => message.subject.startsWith('Réservation déplacée'))!;
      expect(moved.to).toBe(user.email);
      expect(moved.text).toContain('de 11:00 à 12:00');

      expect(logged('booking.rescheduled')).toMatchObject([
        { bookingId: booking.id, resourceId: resource.id, revision: 1 },
      ]);
      // Pas de donnée personnelle dans le log métier.
      expect(JSON.stringify(logged('booking.rescheduled'))).not.toContain(user.email);
    });

    it('même début qu’avant → 200 sans effet ni email', async () => {
      const { agent } = await registerAs(app, 'customer');
      const booking = await confirmedBooking(agent);
      const before = await notificationsOf(booking.id);

      await reschedule(provider.agent, booking.id, new Date(booking.start)).expect(200);

      expect((await rowOf(booking.id)).rescheduleCount).toBe(0);
      expect(await notificationsOf(booking.id)).toHaveLength(before.length);
    });

    it('un hold expiré sur le créneau visé est libéré, le déplacement réussit', async () => {
      const { agent } = await registerAs(app, 'customer');
      const booking = await confirmedBooking(agent);
      const other = await registerAs(app, 'customer');
      const target = instantIn(DAY, '11:00');
      const abandoned = await hold(other.agent, target);
      await db()
        .update(bookings)
        .set({ expiresAt: sql`now() - interval '1 minute'` })
        .where(eq(bookings.id, abandoned.id));

      await reschedule(provider.agent, booking.id, target).expect(200);

      expect((await rowOf(abandoned.id)).status).toBe('expired');
      expect(logged('booking.rescheduled')).toMatchObject([{ expiredHoldsReleased: 1 }]);
    });

    it('une réservation déplacée laisse au client 24 h pour annuler et être remboursé, sans dépasser le début', async () => {
      const { agent } = await registerAs(app, 'customer');
      const moved = await confirmedBooking(agent);
      const untouched = await confirmedBooking(agent, instantIn(DAY, '09:00'));
      await reschedule(provider.agent, moved.id, instantIn(DAY + 1, '10:00')).expect(200);
      // Les deux créneaux commencent dans moins de 24 h : la limite habituelle est dépassée.
      const startsIn = async (id: string, hours: number) =>
        db()
          .update(bookings)
          .set({
            during: sql`tstzrange(now() + make_interval(hours => ${hours}), now() + make_interval(hours => ${hours + 1}), '[)')`,
          })
          .where(eq(bookings.id, id));
      await startsIn(moved.id, 2);
      await startsIn(untouched.id, 3);

      const detail = bookingDetailSchema.parse(
        (await agent.get(`/v1/bookings/${moved.id}`).expect(200)).body,
      );
      expect(detail.rescheduledAt).not.toBeNull();
      expect(new Date(detail.cancellableUntil!).getTime()).toBe(new Date(detail.start).getTime());

      expectCode(
        await agent.post(`/v1/bookings/${untouched.id}/cancel`).expect(409),
        'CANCELLATION_NOT_ALLOWED',
      );
      await agent.post(`/v1/bookings/${moved.id}/cancel`).expect(200);
      expect((await rowOf(moved.id)).status).toBe('cancelled');
      expect(gateway.refund).toHaveBeenCalledTimes(1);
    });

    it('délai de décision écoulé (déplacée il y a 2 jours) : la règle des 24 h reprend', async () => {
      const { agent } = await registerAs(app, 'customer');
      const booking = await confirmedBooking(agent);
      await reschedule(provider.agent, booking.id, instantIn(DAY + 1, '10:00')).expect(200);
      // Déplacée il y a 2 jours, commence dans 3 h : plus de 24 h ont passé depuis le déplacement.
      await db()
        .update(bookings)
        .set({
          rescheduledAt: sql`now() - interval '2 days'`,
          during: sql`tstzrange(now() + interval '3 hours', now() + interval '4 hours', '[)')`,
        })
        .where(eq(bookings.id, booking.id));

      const detail = bookingDetailSchema.parse(
        (await agent.get(`/v1/bookings/${booking.id}`).expect(200)).body,
      );
      expect(detail.cancellableUntil).toBeNull();
      expectCode(
        await agent.post(`/v1/bookings/${booking.id}/cancel`).expect(409),
        'CANCELLATION_NOT_ALLOWED',
      );
      expect(gateway.refund).not.toHaveBeenCalled();
    });

    it('déplacée il y a 1 h, commence dans 3 jours : échéance = début − 24 h (la plus tardive des deux)', async () => {
      const { agent } = await registerAs(app, 'customer');
      const booking = await confirmedBooking(agent);
      await reschedule(provider.agent, booking.id, instantIn(DAY + 1, '10:00')).expect(200);

      const detail = bookingDetailSchema.parse(
        (await agent.get(`/v1/bookings/${booking.id}`).expect(200)).body,
      );
      expect(new Date(detail.cancellableUntil!).getTime()).toBe(
        new Date(detail.start).getTime() - 24 * HOUR_MS,
      );
    });
  });

  describe('créneau refusé', () => {
    it('409 SLOT_UNAVAILABLE : créneau pris par une réservation ou par un hold actif', async () => {
      const { agent } = await registerAs(app, 'customer');
      const booking = await confirmedBooking(agent);
      await confirmedBooking(agent, instantIn(DAY, '11:00'));
      const other = await registerAs(app, 'customer');
      await hold(other.agent, instantIn(DAY, '09:00'));

      for (const time of ['11:00', '09:00']) {
        expectCode(
          await reschedule(provider.agent, booking.id, instantIn(DAY, time)).expect(409),
          'SLOT_UNAVAILABLE',
        );
      }
      const row = await rowOf(booking.id);
      expect(row.rescheduleCount).toBe(0);
      const detail = bookingDetailSchema.parse(
        (await agent.get(`/v1/bookings/${booking.id}`).expect(200)).body,
      );
      expect([detail.start, detail.end]).toEqual([booking.start, booking.end]);
    });

    it('422 SLOT_NOT_OFFERED : hors horaires, non aligné, fermé, passé, au-delà de l’horizon', async () => {
      const { agent } = await registerAs(app, 'customer');
      const booking = await confirmedBooking(agent);
      await provider.agent
        .post(`/v1/resources/${resource.id}/availability-exceptions`)
        .send({
          startLocal: `${localDateIn(DAY + 2)}T00:00`,
          endLocal: `${localDateIn(DAY + 3)}T00:00`,
        })
        .expect(201);

      for (const target of [
        instantIn(DAY, '12:00'),
        instantIn(DAY, '10:30'),
        instantIn(DAY + 2, '10:00'),
        new Date(Date.now() - HOUR_MS),
        instantIn(120, '10:00'),
      ]) {
        expectCode(
          await reschedule(provider.agent, booking.id, target).expect(422),
          'SLOT_NOT_OFFERED',
        );
      }
    });
  });

  describe('réservation non déplaçable', () => {
    it('409 RESCHEDULE_NOT_ALLOWED : hold, réservation annulée, réservation commencée', async () => {
      const { agent } = await registerAs(app, 'customer');
      const pending = await hold(agent, instantIn(DAY, '09:00'));
      const cancelled = await confirmedBooking(agent, instantIn(DAY, '10:00'));
      await agent.post(`/v1/bookings/${cancelled.id}/cancel`).expect(200);
      const started = await confirmedBooking(agent, instantIn(DAY, '11:00'));
      await db()
        .update(bookings)
        .set({
          during: sql`tstzrange(now() - interval '10 minutes', now() + interval '50 minutes', '[)')`,
        })
        .where(eq(bookings.id, started.id));

      for (const id of [pending.id, cancelled.id, started.id]) {
        expectCode(
          await reschedule(provider.agent, id, instantIn(DAY + 1, '10:00')).expect(409),
          'RESCHEDULE_NOT_ALLOWED',
        );
      }
    });

    it('409 RESCHEDULE_NOT_ALLOWED : la durée des créneaux a changé depuis la réservation', async () => {
      const { agent } = await registerAs(app, 'customer');
      const booking = await confirmedBooking(agent);
      await provider.agent
        .patch(`/v1/resources/${resource.id}`)
        .send({ slotMinutes: 30 })
        .expect(200);

      expectCode(
        await reschedule(provider.agent, booking.id, instantIn(DAY + 1, '10:00')).expect(409),
        'RESCHEDULE_NOT_ALLOWED',
      );
      const listed = await provider.agent.get('/v1/providers/me/bookings').expect(200);
      expect((listed.body as { items: { reschedulable: boolean }[] }).items[0]!.reschedulable).toBe(
        false,
      );
    });
  });

  describe('plafond', () => {
    it('au-delà de 3 déplacements → 409 RESCHEDULE_NOT_ALLOWED (le quota d’emails du client est protégé)', async () => {
      const { agent } = await registerAs(app, 'customer');
      const booking = await confirmedBooking(agent);
      for (const day of [1, 2, 3]) {
        await reschedule(provider.agent, booking.id, instantIn(DAY + day, '10:00')).expect(200);
      }

      expectCode(
        await reschedule(provider.agent, booking.id, instantIn(DAY + 4, '10:00')).expect(409),
        'RESCHEDULE_NOT_ALLOWED',
      );
      expect((await rowOf(booking.id)).rescheduleCount).toBe(3);
      const listed = await provider.agent.get('/v1/providers/me/bookings').expect(200);
      expect(
        (listed.body as { items: { id: string; reschedulable: boolean }[] }).items.find(
          (item) => item.id === booking.id,
        )?.reschedulable,
      ).toBe(false);
    });
  });

  describe('autorisations', () => {
    it('401 anonyme, 403 client (même le sien), 403 autre prestataire, 404 inconnue, 400 corps invalide', async () => {
      const { agent } = await registerAs(app, 'customer');
      const booking = await confirmedBooking(agent);
      const target = instantIn(DAY + 1, '10:00');
      const intruder = await createProviderWithResource(app);

      await reschedule(request.agent(app.getHttpServer()), booking.id, target).expect(401);
      await reschedule(agent, booking.id, target).expect(403);
      expectCode(
        await reschedule(intruder.agent, booking.id, target).expect(403),
        'FORBIDDEN_OWNERSHIP',
      );
      expectCode(
        await reschedule(provider.agent, '0b6c1f5e-7d0a-4a8e-9a43-1f0f5c3b2d11', target).expect(
          404,
        ),
        'NOT_FOUND',
      );
      await provider.agent
        .post(`/v1/bookings/${booking.id}/reschedule`)
        .send({ start: 'demain' })
        .expect(400);
      expect((await rowOf(booking.id)).rescheduleCount).toBe(0);
    });
  });

  describe('concurrence', () => {
    it('deux réservations déplacées en même temps sur le même créneau : un 200, un 409', async () => {
      const { agent } = await registerAs(app, 'customer');
      const first = await confirmedBooking(agent, instantIn(DAY, '10:00'));
      const second = await confirmedBooking(agent, instantIn(DAY, '11:00'));
      const target = instantIn(DAY + 1, '09:00');

      const results = await Promise.all([
        reschedule(provider.agent, first.id, target),
        reschedule(provider.agent, second.id, target),
      ]);

      expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
      expectCode(
        results.find((res) => res.status === 409)!,
        'SLOT_UNAVAILABLE',
      );
      const moved = await db()
        .select()
        .from(bookings)
        .where(and(eq(bookings.resourceId, resource.id), eq(bookings.rescheduleCount, 1)));
      expect(moved).toHaveLength(1);
    });

    it('un déplacement et une réservation client en même temps sur le même créneau : un seul réussit', async () => {
      const { agent } = await registerAs(app, 'customer');
      const booking = await confirmedBooking(agent);
      const other = await registerAs(app, 'customer');
      const target = instantIn(DAY + 1, '09:00');

      const [moved, held] = await Promise.all([
        reschedule(provider.agent, booking.id, target),
        other.agent
          .post('/v1/bookings')
          .send({ resourceId: resource.id, start: target.toISOString() }),
      ]);

      // Exactement un des deux obtient le créneau ; l'autre reçoit 409 SLOT_UNAVAILABLE.
      const winners = [moved.status === 200, held.status === 201].filter(Boolean);
      expect(winners).toHaveLength(1);
      const loser = moved.status === 200 ? held : moved;
      expect(loser.status).toBe(409);
      expectCode(loser, 'SLOT_UNAVAILABLE');
    });
  });

  describe('notifications en révisions', () => {
    it('deux déplacements de suite : deux messages distincts, seul le plus récent part', async () => {
      const { agent } = await registerAs(app, 'customer');
      const booking = await confirmedBooking(agent);
      await reschedule(provider.agent, booking.id, instantIn(DAY + 1, '10:00')).expect(200);
      await reschedule(provider.agent, booking.id, instantIn(DAY + 2, '11:00')).expect(200);

      const moved = (await notificationsOf(booking.id)).filter(
        (row) => row.kind === 'booking_moved',
      );
      expect(moved.map((row) => row.bookingRevision)).toEqual([1, 2]);
      // Deux lignes, donc deux clés d'idempotence distinctes chez Resend.
      expect(new Set(moved.map((row) => row.id)).size).toBe(2);

      await runJobs(app, SEND_QUEUE);

      expect(
        subjects().filter((subject) => subject.startsWith('Réservation déplacée')),
      ).toHaveLength(1);
      const after = (await notificationsOf(booking.id)).filter(
        (row) => row.kind === 'booking_moved',
      );
      expect(after).toMatchObject([
        { bookingRevision: 1, status: 'skipped', reason: 'superseded' },
        { bookingRevision: 2, status: 'sent' },
      ]);
      // Un seul rappel reste programmé : celui de la dernière révision.
      const reminders = (await notificationsOf(booking.id)).filter(
        (row) => row.kind === 'booking_reminder' && row.status === 'scheduled',
      );
      expect(reminders).toMatchObject([{ bookingRevision: 2 }]);
    });

    it('un rappel déjà libéré pour l’ancien horaire est écarté à l’envoi', async () => {
      const { agent } = await registerAs(app, 'customer');
      const booking = await confirmedBooking(agent);
      await runJobs(app, SEND_QUEUE);
      email.send.mockClear();
      // Le rappel de l'ancien horaire arrive à échéance et part en file…
      await db()
        .update(notifications)
        .set({ scheduledFor: sql`now() - interval '1 minute'` })
        .where(eq(notifications.status, 'scheduled'));
      await app.get(NotificationsService).dispatchDue();
      // … puis le prestataire déplace la réservation avant l'envoi.
      await reschedule(provider.agent, booking.id, instantIn(DAY + 1, '10:00')).expect(200);

      await runJobs(app, SEND_QUEUE);

      expect(subjects()).toEqual(['Réservation déplacée : Studio A chez Studio Lumière']);
      expect(
        (await notificationsOf(booking.id)).find(
          (row) => row.kind === 'booking_reminder' && row.bookingRevision === 0,
        ),
      ).toMatchObject({ status: 'skipped', reason: 'superseded' });
    });
  });
});
