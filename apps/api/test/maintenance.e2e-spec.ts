import type { INestApplication } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bookings, pendingRegistrations, sessions, stripeEvents } from '@creno/db';
import {
  type Booking,
  type Resource,
  slotsResponseSchema,
  STRIPE_EVENTS_RETENTION_DAYS,
} from '@creno/shared';
import { JobsService } from '../src/jobs/jobs.service.js';
import {
  EXPIRE_HOLDS_QUEUE,
  MaintenanceService,
  PURGE_PENDING_REGISTRATIONS_QUEUE,
  PURGE_SESSIONS_QUEUE,
  PURGE_STRIPE_EVENTS_QUEUE,
} from '../src/maintenance/maintenance.service.js';
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
  runJobs,
  sessionIdOf,
} from './app.js';

const DAY = 7;

describe('jobs de ménage', () => {
  let app: INestApplication;
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
    resource = (await createProviderWithResource(app)).resource;
  });
  afterAll(async () => {
    await app.close();
  });

  const db = () => dbOf(app).db;
  const maintenance = () => app.get(MaintenanceService);
  const logged = (event: string) =>
    logs
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((l) => l.event === event);

  async function hold(agent: request.Agent, time: string) {
    const res = await agent
      .post('/v1/bookings')
      .send({ resourceId: resource.id, start: instantIn(DAY, time).toISOString() })
      .expect(201);
    return res.body as Booking;
  }
  const statusOf = async (id: string) => {
    const [row] = await db()
      .select({ status: bookings.status })
      .from(bookings)
      .where(eq(bookings.id, id));
    return row!.status;
  };
  const lapse = (id: string) =>
    db()
      .update(bookings)
      .set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(eq(bookings.id, id));
  const availability = async () => {
    const date = localDateIn(DAY);
    const res = await request(app.getHttpServer())
      .get(`/v1/resources/${resource.id}/slots?from=${date}&to=${date}`)
      .expect(200);
    return slotsResponseSchema.parse(res.body).days[0]!.slots.map((s) => s.available);
  };

  describe('holds expirés', () => {
    it('passe à expired les holds échus, ferme leur session Checkout, et ne touche à rien d’autre', async () => {
      const { agent } = await registerAs(app, 'customer');
      // 09:00 : hold échu après le lancement du paiement ; 10:00 : hold actif ; 11:00 : confirmé.
      const overdue = await hold(agent, '09:00');
      await agent.post(`/v1/bookings/${overdue.id}/checkout`).expect(200);
      await lapse(overdue.id);
      const active = await hold(agent, '10:00');
      const confirmed = await hold(agent, '11:00');
      await agent.post(`/v1/bookings/${confirmed.id}/checkout`).expect(200);
      await postStripeEvent(app, 'checkout.session.completed', paidSession(confirmed)).expect(200);
      gateway.expireCheckoutSession.mockClear();

      expect(await maintenance().expireHolds()).toBe(1);

      expect(await statusOf(overdue.id)).toBe('expired');
      expect(await statusOf(active.id)).toBe('pending');
      expect(await statusOf(confirmed.id)).toBe('confirmed');
      expect(await availability()).toEqual([true, false, false]);
      expect(gateway.expireCheckoutSession).toHaveBeenCalledTimes(1);
      expect(gateway.expireCheckoutSession).toHaveBeenCalledWith(sessionIdOf(overdue.id));
      expect(logged('maintenance.holds_expired')).toMatchObject([{ count: 1 }]);
      // Second passage : plus rien à faire.
      expect(await maintenance().expireHolds()).toBe(0);
    });

    it('hold échu sans session Checkout → expiré sans appel à Stripe', async () => {
      const { agent } = await registerAs(app, 'customer');
      const overdue = await hold(agent, '09:00');
      await lapse(overdue.id);

      expect(await maintenance().expireHolds()).toBe(1);
      expect(gateway.expireCheckoutSession).not.toHaveBeenCalled();
    });

    it('Stripe en panne → le hold est expiré quand même, avec un log warn', async () => {
      const { agent } = await registerAs(app, 'customer');
      const overdue = await hold(agent, '09:00');
      await agent.post(`/v1/bookings/${overdue.id}/checkout`).expect(200);
      await lapse(overdue.id);
      gateway.expireCheckoutSession.mockRejectedValueOnce(new PaymentsGatewayError('network'));

      expect(await maintenance().expireHolds()).toBe(1);

      expect(await statusOf(overdue.id)).toBe('expired');
      expect(logged('payment.gateway_failed')).toMatchObject([
        { level: 40, operation: 'expire_session', bookingId: overdue.id, reason: 'network' },
      ]);
    });

    it('un paiement reçu après le passage du job confirme encore la réservation si le créneau est libre', async () => {
      const { agent } = await registerAs(app, 'customer');
      const overdue = await hold(agent, '09:00');
      await agent.post(`/v1/bookings/${overdue.id}/checkout`).expect(200);
      await lapse(overdue.id);
      await maintenance().expireHolds();

      await postStripeEvent(app, 'checkout.session.completed', paidSession(overdue)).expect(200);

      expect(await statusOf(overdue.id)).toBe('confirmed');
    });
  });

  it('purge les sessions expirées ou révoquées de tous les utilisateurs, garde les actives', async () => {
    const first = await registerAs(app, 'customer');
    const second = await registerAs(app, 'customer');
    await db()
      .insert(sessions)
      .values([
        {
          userId: first.user.id,
          refreshTokenHash: 'hash-expiree',
          createdAt: sql`now() - interval '40 days'`,
          expiresAt: sql`now() - interval '10 days'`,
        },
        {
          userId: second.user.id,
          refreshTokenHash: 'hash-revoquee',
          expiresAt: sql`now() + interval '10 days'`,
          revokedAt: sql`now()`,
        },
      ]);
    const before = await db().select({ id: sessions.id }).from(sessions);

    expect(await maintenance().purgeSessions()).toBe(2);

    expect(await db().select({ id: sessions.id }).from(sessions)).toHaveLength(before.length - 2);
    // Les sessions en cours fonctionnent toujours.
    await first.agent.get('/v1/users/me').expect(200);
    await second.agent.get('/v1/users/me').expect(200);
    expect(logged('maintenance.sessions_purged')).toMatchObject([{ count: 2 }]);
  });

  it(`purge les événements Stripe de plus de ${STRIPE_EVENTS_RETENTION_DAYS} jours seulement`, async () => {
    await db()
      .insert(stripeEvents)
      .values([
        { id: 'evt_ancien', type: 'charge.refunded', receivedAt: sql`now() - interval '91 days'` },
        { id: 'evt_limite', type: 'charge.refunded', receivedAt: sql`now() - interval '89 days'` },
        { id: 'evt_recent', type: 'charge.refunded' },
      ]);

    expect(await maintenance().purgeStripeEvents()).toBe(1);

    const left = await db().select({ id: stripeEvents.id }).from(stripeEvents);
    expect(left.map((row) => row.id).sort()).toEqual(['evt_limite', 'evt_recent']);
  });

  it('purge les inscriptions en attente dont le lien a expiré, garde les autres', async () => {
    const attempt = { fullName: 'Léa', role: 'customer' as const, passwordHash: 'hash' };
    await db()
      .insert(pendingRegistrations)
      .values([
        {
          ...attempt,
          email: 'expiree@test.dev',
          createdAt: sql`now() - interval '25 hours'`,
          expiresAt: sql`now() - interval '1 hour'`,
        },
        { ...attempt, email: 'valable@test.dev', expiresAt: sql`now() + interval '23 hours'` },
      ]);

    expect(await maintenance().purgePendingRegistrations()).toBe(1);

    const left = await db()
      .select({ email: pendingRegistrations.email })
      .from(pendingRegistrations);
    expect(left).toEqual([{ email: 'valable@test.dev' }]);
    expect(logged('maintenance.pending_registrations_purged')).toMatchObject([{ count: 1 }]);
  });

  it('chaque tâche est branchée sur sa file : un job reçu l’exécute', async () => {
    const { agent } = await registerAs(app, 'customer');
    const overdue = await hold(agent, '09:00');
    await lapse(overdue.id);
    const jobs = app.get(JobsService);
    for (const queue of [
      EXPIRE_HOLDS_QUEUE,
      PURGE_SESSIONS_QUEUE,
      PURGE_STRIPE_EVENTS_QUEUE,
      PURGE_PENDING_REGISTRATIONS_QUEUE,
    ]) {
      await jobs.send(queue, {});
      expect(await runJobs(app, queue)).toBe(1);
    }

    expect(await statusOf(overdue.id)).toBe('expired');
    expect(logged('maintenance.sessions_purged')).toHaveLength(1);
    expect(logged('maintenance.stripe_events_purged')).toHaveLength(1);
    expect(logged('maintenance.pending_registrations_purged')).toHaveLength(1);
  });
});
