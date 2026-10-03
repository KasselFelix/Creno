import type { INestApplication } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import type request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bookings, notifications } from '@creno/db';
import { type Booking, REMINDER_LEAD_HOURS, type Resource } from '@creno/shared';
import { JobsService } from '../src/jobs/jobs.service.js';
import { DeliveryError } from '../src/notifications/delivery.js';
import { NotificationsRepository } from '../src/notifications/notifications.repository.js';
import {
  DEAD_QUEUE,
  MAX_EMAILS_PER_RECIPIENT_PER_HOUR,
  SEND_QUEUE,
  SEND_RETRY_LIMIT,
} from '../src/notifications/notifications.queues.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { SMS_MAX_LENGTH } from '../src/notifications/templates.js';
import {
  createProviderWithResource,
  createTestApp,
  dbOf,
  everyDay,
  fakeEmailGateway,
  fakePaymentsGateway,
  fakeSmsGateway,
  instantIn,
  paidSession,
  postStripeEvent,
  registerAs,
  RESOURCE_INPUT,
  resetDatabase,
  resetPaymentsGateway,
  runJobs,
  setVerifiedPhone,
} from './app.js';

const DAY = 7;
const PHONE = '+33612345678';

describe('notifications', () => {
  let app: INestApplication;
  let provider: Awaited<ReturnType<typeof createProviderWithResource>>;
  let resource: Resource;
  const gateway = fakePaymentsGateway();
  const email = fakeEmailGateway();
  const sms = fakeSmsGateway();
  const logs: string[] = [];

  beforeAll(async () => {
    app = await createTestApp({ payments: gateway, email, sms, logs });
  });
  beforeEach(async () => {
    await resetDatabase(app);
    resetPaymentsGateway(gateway);
    email.send.mockClear();
    sms.send.mockClear();
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
  // Les lignes d'une même transaction ont la même date : l'ordre des enums départage.
  const rows = () =>
    db()
      .select()
      .from(notifications)
      .orderBy(asc(notifications.createdAt), asc(notifications.kind), asc(notifications.channel));
  const rowsOf = async (bookingId: string) =>
    (await rows()).filter((row) => row.bookingId === bookingId);
  const emails = () => email.send.mock.calls.map(([message]) => message);

  async function hold(agent: request.Agent, time = '10:00', resourceId = resource.id) {
    const res = await agent
      .post('/v1/bookings')
      .send({ resourceId, start: instantIn(DAY, time).toISOString() })
      .expect(201);
    return res.body as Booking;
  }

  /** Hold payé puis confirmé par le webhook, comme en production. */
  async function confirmedBooking(agent: request.Agent, time = '10:00') {
    const booking = await hold(agent, time);
    await agent.post(`/v1/bookings/${booking.id}/checkout`).expect(200);
    await postStripeEvent(app, 'checkout.session.completed', paidSession(booking)).expect(200);
    return booking;
  }

  async function customerWithPhone() {
    const customer = await registerAs(app, 'customer');
    await setVerifiedPhone(app, customer.user.id, PHONE);
    return customer;
  }

  const makeRemindersDue = () =>
    db()
      .update(notifications)
      .set({ scheduledFor: sql`now() - interval '1 minute'` })
      .where(eq(notifications.status, 'scheduled'));

  describe('réservation confirmée', () => {
    it('paiement reçu → confirmation au client, avis au prestataire, rappel planifié 24 h avant', async () => {
      const { agent, user } = await registerAs(app, 'customer');
      const booking = await confirmedBooking(agent);

      expect(await rows()).toMatchObject([
        { kind: 'booking_confirmed', channel: 'email', recipientId: user.id, status: 'pending' },
        {
          kind: 'booking_received',
          channel: 'email',
          recipientId: provider.user.id,
          status: 'pending',
        },
        { kind: 'booking_reminder', channel: 'email', recipientId: user.id, status: 'scheduled' },
      ]);
      const reminder = (await rows())[2]!;
      expect(reminder.scheduledFor.getTime()).toBe(
        new Date(booking.start).getTime() - REMINDER_LEAD_HOURS * 3_600_000,
      );
      // Rien n'est envoyé pendant le webhook : c'est le travail du job.
      expect(email.send).not.toHaveBeenCalled();

      expect(await runJobs(app, SEND_QUEUE)).toBe(2);

      expect(emails()).toHaveLength(2);
      const toCustomer = emails().find((message) => message.to === user.email)!;
      expect(toCustomer.subject).toBe('Réservation confirmée : Studio A chez Studio Lumière');
      expect(toCustomer.text).toContain('Paiement reçu : 45,00');
      expect(toCustomer.text).toContain(
        `http://localhost:3000/bookings/${booking.id}/confirmation`,
      );
      const toProvider = emails().find((message) => message.to === provider.user.email)!;
      expect(toProvider.subject).toBe('Nouvelle réservation : Studio A');
      expect(toProvider.text).toContain('Test customer a réservé Studio A');

      const sent = (await rows()).filter((row) => row.status === 'sent');
      expect(sent).toHaveLength(2);
      for (const row of sent) {
        expect(row.sentAt).toBeInstanceOf(Date);
        expect(row.providerMessageId).toMatch(/^email_fake_/);
        expect(row.attempts).toBe(1);
      }
      // La clé d'idempotence transmise au fournisseur est l'identifiant de la notification.
      expect(sent.map((row) => row.id).sort()).toEqual(
        emails()
          .map((message) => message.idempotencyKey)
          .sort(),
      );
      expect(logged('notification.sent')).toHaveLength(2);
    });

    it('événement rejoué → aucune ligne ni envoi supplémentaire', async () => {
      const { agent } = await registerAs(app, 'customer');
      const booking = await hold(agent);
      await agent.post(`/v1/bookings/${booking.id}/checkout`).expect(200);
      const event = { id: 'evt_test_rejoue' };
      await postStripeEvent(app, 'checkout.session.completed', paidSession(booking), event);
      await postStripeEvent(app, 'checkout.session.completed', paidSession(booking), event);
      // Un autre événement pour la même session ne notifie pas une seconde fois non plus.
      await postStripeEvent(app, 'checkout.session.completed', paidSession(booking)).expect(200);

      expect(await rows()).toHaveLength(3);
      expect(await runJobs(app, SEND_QUEUE)).toBe(2);
      expect(await runJobs(app, SEND_QUEUE)).toBe(0);
      expect(email.send).toHaveBeenCalledTimes(2);
    });

    it('client avec un téléphone → un rappel par SMS en plus', async () => {
      const { agent, user } = await customerWithPhone();
      await confirmedBooking(agent);

      expect((await rows()).map((row) => [row.kind, row.channel, row.status])).toEqual([
        ['booking_confirmed', 'email', 'pending'],
        ['booking_received', 'email', 'pending'],
        ['booking_reminder', 'email', 'scheduled'],
        ['booking_reminder', 'sms', 'scheduled'],
      ]);
      expect((await rows())[3]!.recipientId).toBe(user.id);
    });

    it('ressource gratuite → mêmes notifications, sans Stripe', async () => {
      const created = await provider.agent
        .post('/v1/resources')
        .send({ ...RESOURCE_INPUT, name: 'Visite', priceCents: 0 })
        .expect(201);
      const freeId = (created.body as Resource).id;
      await provider.agent
        .put(`/v1/resources/${freeId}/availability-rules`)
        .send({ rules: everyDay('09:00', '12:00') })
        .expect(200);
      const { agent, user } = await registerAs(app, 'customer');
      const booking = await hold(agent, '10:00', freeId);
      await agent.post(`/v1/bookings/${booking.id}/checkout`).expect(200);

      expect((await rows()).map((row) => row.kind)).toEqual([
        'booking_confirmed',
        'booking_received',
        'booking_reminder',
      ]);
      await runJobs(app, SEND_QUEUE);
      const toCustomer = emails().find((message) => message.to === user.email)!;
      expect(toCustomer.text).toContain('Aucun paiement à prévoir.');
      expect(gateway.createCheckoutSession).not.toHaveBeenCalled();
    });

    it('créneau à moins de 24 h → pas de rappel', async () => {
      const { agent } = await registerAs(app, 'customer');
      const booking = await hold(agent);
      await agent.post(`/v1/bookings/${booking.id}/checkout`).expect(200);
      await db()
        .update(bookings)
        .set({
          during: sql`tstzrange(now() + interval '23 hours', now() + interval '24 hours', '[)')`,
        })
        .where(eq(bookings.id, booking.id));
      await postStripeEvent(app, 'checkout.session.completed', paidSession(booking)).expect(200);

      expect((await rows()).map((row) => row.kind)).toEqual([
        'booking_confirmed',
        'booking_received',
      ]);
    });

    it('transaction annulée → ni notification ni job (outbox transactionnelle)', async () => {
      const { agent } = await registerAs(app, 'customer');
      const booking = await hold(agent);
      const service = app.get(NotificationsService);

      await expect(
        db().transaction(async (tx) => {
          await service.bookingConfirmed(booking.id, tx);
          throw new Error('annulation');
        }),
      ).rejects.toThrow('annulation');

      expect(await rows()).toHaveLength(0);
      expect(await runJobs(app, SEND_QUEUE)).toBe(0);
    });

    it('webhook en échec après la création des notifications → rien ne reste, puis le renvoi de Stripe aboutit', async () => {
      const { agent } = await registerAs(app, 'customer');
      const booking = await hold(agent);
      await agent.post(`/v1/bookings/${booking.id}/checkout`).expect(200);
      // Le second job de la transaction ne peut pas être créé : toute la transaction est annulée.
      const jobs = app.get(JobsService);
      const send = vi.spyOn(jobs, 'send');
      send.mockImplementationOnce(send.getMockImplementation() ?? jobs.send.bind(jobs));
      send.mockRejectedValueOnce(new Error('file indisponible'));
      const event = { id: 'evt_test_echec' };

      await postStripeEvent(app, 'checkout.session.completed', paidSession(booking), event).expect(
        500,
      );
      send.mockRestore();

      expect(await rows()).toHaveLength(0);
      expect(await runJobs(app, SEND_QUEUE)).toBe(0);
      const [row] = await db().select().from(bookings).where(eq(bookings.id, booking.id));
      expect(row!.status).toBe('pending');

      await postStripeEvent(app, 'checkout.session.completed', paidSession(booking), event).expect(
        200,
      );
      expect(await rows()).toHaveLength(3);
      expect(await runJobs(app, SEND_QUEUE)).toBe(2);
    });

    it('job livré deux fois → un seul envoi', async () => {
      const { agent } = await registerAs(app, 'customer');
      await confirmedBooking(agent);
      await runJobs(app, SEND_QUEUE);
      const sent = (await rows()).find((row) => row.status === 'sent')!;

      await app.get(JobsService).send(SEND_QUEUE, { notificationId: sent.id });
      expect(await runJobs(app, SEND_QUEUE)).toBe(1);

      expect(email.send).toHaveBeenCalledTimes(2);
      expect((await rows()).find((row) => row.id === sent.id)).toMatchObject({ attempts: 1 });
    });

    it('prestataire qui réserve chez lui-même → il reçoit la confirmation et l’avis, sans conflit', async () => {
      const booking = await confirmedBooking(provider.agent);
      expect((await rows()).map((row) => [row.kind, row.recipientId])).toEqual([
        ['booking_confirmed', provider.user.id],
        ['booking_received', provider.user.id],
        ['booking_reminder', provider.user.id],
      ]);

      // Il annule en tant que client : les deux destinataires sont la même personne, une seule ligne.
      await provider.agent.post(`/v1/bookings/${booking.id}/cancel`).expect(200);
      expect((await rows()).filter((row) => row.kind === 'booking_cancelled')).toHaveLength(1);
    });

    it('délai dépassé pendant l’envoi d’un SMS → `failed` sans reprise (il est peut-être parti)', async () => {
      const { agent } = await customerWithPhone();
      await confirmedBooking(agent);
      await runJobs(app, SEND_QUEUE);
      await makeRemindersDue();
      await app.get(NotificationsService).dispatchDue();
      sms.send.mockRejectedValueOnce(new DeliveryError('timeout', true));

      await runJobs(app, SEND_QUEUE);

      expect(
        (await rows()).find((row) => row.kind === 'booking_reminder' && row.channel === 'sms'),
      ).toMatchObject({ status: 'failed', reason: 'timeout', attempts: 1 });
      expect(await runJobs(app, SEND_QUEUE)).toBe(0);
      expect(sms.send).toHaveBeenCalledTimes(1);
    });

    it('SMS parti mais statut impossible à écrire → pas de rejeu (Twilio n’a pas de clé d’idempotence)', async () => {
      const { agent } = await customerWithPhone();
      await confirmedBooking(agent);
      await runJobs(app, SEND_QUEUE);
      await makeRemindersDue();
      await app.get(NotificationsService).dispatchDue();
      const repository = app.get(NotificationsRepository);
      const markSent = vi.spyOn(repository, 'markSent');
      markSent.mockRejectedValue(new Error('base coupée'));

      await runJobs(app, SEND_QUEUE);
      markSent.mockRestore();

      expect(sms.send).toHaveBeenCalledTimes(1);
      expect(logged('notification.sent_unrecorded')).toMatchObject([
        { level: 50, channel: 'sms', providerMessageId: 'sms_fake_1' },
      ]);
      // Le job du SMS est terminé ; celui de l'email reste à rejouer (clé d'idempotence côté Resend).
      expect(await runJobs(app, SEND_QUEUE)).toBe(1);
      expect(sms.send).toHaveBeenCalledTimes(1);
    });

    it('réservation annulée avant l’envoi → la confirmation n’est pas envoyée', async () => {
      const { agent } = await registerAs(app, 'customer');
      const booking = await confirmedBooking(agent);
      await agent.post(`/v1/bookings/${booking.id}/cancel`).expect(200);
      await runJobs(app, SEND_QUEUE);

      const byKind = Object.fromEntries(
        (await rows()).map((row) => [`${row.kind}:${row.recipientId}`, row]),
      );
      const customerId = (await rows())[0]!.recipientId;
      expect(byKind[`booking_confirmed:${customerId}`]).toMatchObject({
        status: 'skipped',
        reason: 'booking_not_confirmed',
      });
      expect(byKind[`booking_cancelled:${customerId}`]).toMatchObject({ status: 'sent' });
      expect(emails().map((message) => message.subject)).not.toContain(
        'Réservation confirmée : Studio A chez Studio Lumière',
      );
    });
  });

  describe('rappel', () => {
    it('n’est mis en file qu’à son échéance, puis part par email et par SMS', async () => {
      const { agent, user } = await customerWithPhone();
      await confirmedBooking(agent);
      await runJobs(app, SEND_QUEUE);
      email.send.mockClear();
      const service = app.get(NotificationsService);

      // Pas encore dû : rien ne bouge.
      expect(await service.dispatchDue()).toBe(0);
      expect(await runJobs(app, SEND_QUEUE)).toBe(0);

      await makeRemindersDue();
      expect(await service.dispatchDue()).toBe(2);
      // Un second passage ne remet rien en file.
      expect(await service.dispatchDue()).toBe(0);
      expect(await runJobs(app, SEND_QUEUE)).toBe(2);

      expect(emails()).toMatchObject([
        { to: user.email, subject: 'Rappel : Studio A chez Studio Lumière' },
      ]);
      expect(sms.send).toHaveBeenCalledTimes(1);
      const message = sms.send.mock.calls[0]![0];
      expect(message.to).toBe(PHONE);
      expect(message.body).toMatch(/^Creno - Rappel : Studio A chez Studio Lumière, .+ à 10:00\.$/);
      expect(message.body.length).toBeLessThanOrEqual(SMS_MAX_LENGTH);
      expect(
        (await rows()).filter((row) => row.kind === 'booking_reminder').map((row) => row.status),
      ).toEqual(['sent', 'sent']);
      expect(logged('notification.reminders_dispatched')).toMatchObject([{ count: 2 }]);
    });

    it('réservation annulée entre-temps → rappel `skipped`, rien n’est envoyé', async () => {
      const { agent } = await customerWithPhone();
      const booking = await confirmedBooking(agent);
      await agent.post(`/v1/bookings/${booking.id}/cancel`).expect(200);
      await runJobs(app, SEND_QUEUE);
      email.send.mockClear();

      await makeRemindersDue();
      await app.get(NotificationsService).dispatchDue();
      await runJobs(app, SEND_QUEUE);

      expect(email.send).not.toHaveBeenCalled();
      expect(sms.send).not.toHaveBeenCalled();
      expect((await rows()).filter((row) => row.kind === 'booking_reminder')).toMatchObject([
        { status: 'skipped', reason: 'booking_not_confirmed' },
        { status: 'skipped', reason: 'booking_not_confirmed' },
      ]);
    });

    it('créneau déjà commencé, ou téléphone retiré → `skipped`', async () => {
      const first = await customerWithPhone();
      await confirmedBooking(first.agent, '09:00');
      await first.agent.delete('/v1/users/me/phone').expect(204);
      const second = await registerAs(app, 'customer');
      const started = await confirmedBooking(second.agent, '10:00');
      await db()
        .update(bookings)
        .set({
          during: sql`tstzrange(now() - interval '10 minutes', now() + interval '50 minutes', '[)')`,
        })
        .where(eq(bookings.id, started.id));

      await makeRemindersDue();
      await app.get(NotificationsService).dispatchDue();
      await runJobs(app, SEND_QUEUE);

      const reminders = (await rows()).filter((row) => row.kind === 'booking_reminder');
      const summary = reminders.map((row) => [
        row.recipientId,
        row.channel,
        row.status,
        row.reason,
      ]);
      expect(summary).toHaveLength(3);
      expect(summary).toEqual(
        expect.arrayContaining([
          [first.user.id, 'email', 'sent', null],
          [first.user.id, 'sms', 'skipped', 'no_phone'],
          [second.user.id, 'email', 'skipped', 'too_late'],
        ]),
      );
      expect(sms.send).not.toHaveBeenCalled();
    });
  });

  describe('annulation', () => {
    it('par le client → email au client (remboursement rappelé) et au prestataire', async () => {
      const { agent, user } = await registerAs(app, 'customer');
      const booking = await confirmedBooking(agent);
      await runJobs(app, SEND_QUEUE);
      email.send.mockClear();

      await agent.post(`/v1/bookings/${booking.id}/cancel`).expect(200);
      expect(await runJobs(app, SEND_QUEUE)).toBe(2);

      const toCustomer = emails().find((message) => message.to === user.email)!;
      expect(toCustomer.subject).toBe('Réservation annulée : Studio A chez Studio Lumière');
      expect(toCustomer.text).toContain('Vous êtes remboursé de 45,00');
      const toProvider = emails().find((message) => message.to === provider.user.email)!;
      expect(toProvider.subject).toBe('Réservation annulée : Studio A');
      expect(toProvider.text).toContain('Test customer a annulé sa réservation');
    });

    it('par le prestataire → email au client seulement', async () => {
      const { agent, user } = await registerAs(app, 'customer');
      const booking = await confirmedBooking(agent);
      await runJobs(app, SEND_QUEUE);
      email.send.mockClear();

      await provider.agent.post(`/v1/bookings/${booking.id}/cancel`).expect(200);
      expect(await runJobs(app, SEND_QUEUE)).toBe(1);

      expect(emails()).toMatchObject([
        { to: user.email, subject: 'Réservation annulée par Studio Lumière' },
      ]);
      expect((await rowsOf(booking.id)).at(-1)).toMatchObject({
        kind: 'booking_cancelled_by_provider',
        status: 'sent',
      });
    });

    it('d’un hold jamais confirmé → aucune notification', async () => {
      const { agent } = await registerAs(app, 'customer');
      const booking = await hold(agent);
      await agent.post(`/v1/bookings/${booking.id}/cancel`).expect(200);

      expect(await rows()).toHaveLength(0);
    });
  });

  it('paiement tardif sur un créneau repris → email de remboursement au payeur, pas de confirmation', async () => {
    const late = await registerAs(app, 'customer');
    const lateBooking = await hold(late.agent);
    await late.agent.post(`/v1/bookings/${lateBooking.id}/checkout`).expect(200);
    await db()
      .update(bookings)
      .set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(eq(bookings.id, lateBooking.id));
    const winner = await registerAs(app, 'customer');
    await hold(winner.agent);

    await postStripeEvent(app, 'checkout.session.completed', paidSession(lateBooking)).expect(200);

    expect(await rows()).toMatchObject([
      { kind: 'payment_refunded_late', recipientId: late.user.id, bookingId: lateBooking.id },
    ]);
    await runJobs(app, SEND_QUEUE);
    expect(emails()).toHaveLength(1);
    expect(emails()[0]).toMatchObject({
      to: late.user.email,
      subject: 'Paiement remboursé : Studio A chez Studio Lumière',
    });
    expect(emails()[0]!.text).toContain('Vous êtes remboursé de 45,00');
    expect(emails()[0]!.text).toContain('http://localhost:3000/providers/studio-lumiere');
  });

  describe('échecs d’envoi', () => {
    const confirmationOf = async (bookingId: string) =>
      (await rowsOf(bookingId)).find((row) => row.kind === 'booking_confirmed')!;

    /** Seul l'email de confirmation du client échoue : celui du prestataire part normalement. */
    function failFor(to: string, error: DeliveryError, times = Infinity) {
      let failures = 0;
      email.send.mockImplementation(async (message) => {
        if (message.to === to && failures < times) {
          failures += 1;
          throw error;
        }
        return { messageId: 'email_fake_ok' };
      });
    }

    it('panne temporaire → le job est rejoué, puis l’email part', async () => {
      const { agent, user } = await registerAs(app, 'customer');
      const booking = await confirmedBooking(agent);
      failFor(user.email, new DeliveryError('http_503', true), 1);

      await runJobs(app, SEND_QUEUE);
      expect(await confirmationOf(booking.id)).toMatchObject({ status: 'pending', attempts: 1 });
      expect(logged('notification.retry')).toMatchObject([
        { level: 40, reason: 'http_503', attempt: 1, kind: 'booking_confirmed' },
      ]);

      expect(await runJobs(app, SEND_QUEUE)).toBe(1);
      expect(await confirmationOf(booking.id)).toMatchObject({ status: 'sent', attempts: 2 });
    });

    it('reprises épuisées → file morte, notification `failed`, log error', async () => {
      const { agent, user } = await registerAs(app, 'customer');
      const booking = await confirmedBooking(agent);
      failFor(user.email, new DeliveryError('timeout', true));

      for (let attempt = 0; attempt <= SEND_RETRY_LIMIT; attempt++) await runJobs(app, SEND_QUEUE);
      expect(await runJobs(app, SEND_QUEUE)).toBe(0);
      expect(await confirmationOf(booking.id)).toMatchObject({
        status: 'pending',
        attempts: SEND_RETRY_LIMIT + 1,
      });

      expect(await runJobs(app, DEAD_QUEUE)).toBe(1);
      expect(await confirmationOf(booking.id)).toMatchObject({
        status: 'failed',
        reason: 'retries_exhausted',
      });
      expect(logged('notification.failed')).toMatchObject([
        { level: 50, reason: 'retries_exhausted' },
      ]);
    });

    it('refus définitif du fournisseur → `failed` tout de suite, sans reprise', async () => {
      const { agent, user } = await registerAs(app, 'customer');
      const booking = await confirmedBooking(agent);
      failFor(user.email, new DeliveryError('http_422', false));

      await runJobs(app, SEND_QUEUE);

      expect(await confirmationOf(booking.id)).toMatchObject({
        status: 'failed',
        reason: 'http_422',
        attempts: 1,
      });
      expect(await runJobs(app, SEND_QUEUE)).toBe(0);
      expect(logged('notification.failed')).toMatchObject([{ level: 50, reason: 'http_422' }]);
      email.send.mockImplementation(fakeEmailGateway().send.getMockImplementation()!);
    });
  });

  describe('garde-fous contre l’abus', () => {
    // Le numéro a été vérifié avant que la liste des préfixes ne change : le worker revérifie.
    it('numéro hors des préfixes autorisés → SMS `skipped`, l’email part', async () => {
      const customer = await registerAs(app, 'customer');
      await setVerifiedPhone(app, customer.user.id, '+447900000000');
      await confirmedBooking(customer.agent);
      await runJobs(app, SEND_QUEUE);
      await makeRemindersDue();
      await app.get(NotificationsService).dispatchDue();
      await runJobs(app, SEND_QUEUE);

      expect(sms.send).not.toHaveBeenCalled();
      expect((await rows()).filter((row) => row.kind === 'booking_reminder')).toMatchObject([
        { channel: 'email', status: 'sent' },
        { channel: 'sms', status: 'skipped', reason: 'destination_not_allowed' },
      ]);
    });

    it(`au-delà de ${MAX_EMAILS_PER_RECIPIENT_PER_HOUR} emails par heure au même destinataire → \`skipped\``, async () => {
      const { agent, user } = await registerAs(app, 'customer');
      const booking = await confirmedBooking(agent);
      await runJobs(app, SEND_QUEUE);
      email.send.mockClear();
      // Le plafond est atteint : la confirmation déjà envoyée est comptée 30 fois (autres créneaux).
      const [confirmation] = await rowsOf(booking.id);
      const others = await db()
        .insert(bookings)
        .values(
          Array.from({ length: MAX_EMAILS_PER_RECIPIENT_PER_HOUR - 1 }, (_, i) => ({
            resourceId: resource.id,
            customerId: user.id,
            during: sql`tstzrange(now() + make_interval(days => ${40 + i}), now() + make_interval(days => ${40 + i}, hours => 1), '[)')`,
            status: 'cancelled' as const,
            cancelledAt: sql`now()`,
            priceCents: 0,
          })),
        )
        .returning({ id: bookings.id });
      await db()
        .insert(notifications)
        .values(
          others.map(({ id }) => ({
            bookingId: id,
            recipientId: user.id,
            kind: confirmation!.kind,
            channel: 'email' as const,
            status: 'sent' as const,
            sentAt: sql`now()`,
          })),
        );

      await agent.post(`/v1/bookings/${booking.id}/cancel`).expect(200);
      await runJobs(app, SEND_QUEUE);

      // Le prestataire, lui, reçoit toujours son email.
      expect(emails().map((message) => message.to)).toEqual([provider.user.email]);
      expect(
        (await rowsOf(booking.id)).find(
          (row) => row.kind === 'booking_cancelled' && row.recipientId === user.id,
        ),
      ).toMatchObject({ status: 'skipped', reason: 'rate_limited' });
      expect(logged('notification.skipped')).toMatchObject([{ level: 40, reason: 'rate_limited' }]);
    });
  });

  it('le numéro d’un autre compte ne reçoit rien : un numéro demandé mais non vérifié ne sert pas au rappel', async () => {
    const owner = await customerWithPhone();
    const intruder = await registerAs(app, 'customer');
    // Le numéro reçoit un code, que l'intrus n'a pas : le numéro ne lui est jamais attribué.
    await intruder.agent.post('/v1/users/me/phone').send({ phone: PHONE }).expect(202);
    await intruder.agent.patch('/v1/users/me').send({ phone: PHONE }).expect(400);
    const booking = await confirmedBooking(intruder.agent);
    await runJobs(app, SEND_QUEUE);
    await makeRemindersDue();
    await app.get(NotificationsService).dispatchDue();
    await runJobs(app, SEND_QUEUE);

    expect(sms.send).not.toHaveBeenCalled();
    expect((await rowsOf(booking.id)).filter((row) => row.channel === 'sms')).toEqual([]);
    const me = await owner.agent.get('/v1/users/me').expect(200);
    expect((me.body as { phone: string | null }).phone).toBe(PHONE);
  });

  it('les jobs ne portent qu’un identifiant, et les logs aucune donnée personnelle', async () => {
    const { agent, user } = await customerWithPhone();
    await confirmedBooking(agent);
    const jobs = await db().execute<{ data: unknown }>(
      sql`SELECT data FROM pgboss.job WHERE name = ${SEND_QUEUE}`,
    );
    expect(jobs.rows).toHaveLength(2);
    for (const job of jobs.rows)
      expect(Object.keys(job.data as object)).toEqual(['notificationId']);

    await runJobs(app, SEND_QUEUE);
    await makeRemindersDue();
    await app.get(NotificationsService).dispatchDue();
    await runJobs(app, SEND_QUEUE);

    const all = logs.join('\n');
    expect(logged('notification.sent')).toHaveLength(4);
    expect(all).not.toContain(user.email);
    expect(all).not.toContain(provider.user.email);
    expect(all).not.toContain(PHONE);
    expect(all).not.toContain('Réservation confirmée');
  });
});
