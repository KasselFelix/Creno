import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notifications } from '@creno/db';
import type { Booking } from '@creno/shared';
import { SEND_QUEUE } from '../src/notifications/notifications.queues.js';
import {
  createProviderWithResource,
  createTestApp,
  dbOf,
  fakePaymentsGateway,
  instantIn,
  paidSession,
  postStripeEvent,
  registerAs,
  resetDatabase,
  runJobs,
} from './app.js';

const DAY = 7;

// Fichier à part : les logs émis hors requête (jobs) vont au premier logger créé dans le processus.
describe('notifications sans passerelle configurée', () => {
  let app: INestApplication;
  const logs: string[] = [];

  beforeAll(async () => {
    app = await createTestApp({ payments: fakePaymentsGateway(), logs });
    await resetDatabase(app);
  });
  afterAll(async () => {
    await app.close();
  });

  it('la réservation fonctionne, les notifications sont `skipped` avec un log warn', async () => {
    const { resource } = await createProviderWithResource(app);
    const { agent } = await registerAs(app, 'customer');
    const res = await agent
      .post('/v1/bookings')
      .send({ resourceId: resource.id, start: instantIn(DAY, '10:00').toISOString() })
      .expect(201);
    const booking = res.body as Booking;
    await agent.post(`/v1/bookings/${booking.id}/checkout`).expect(200);
    await postStripeEvent(app, 'checkout.session.completed', paidSession(booking)).expect(200);

    expect(await runJobs(app, SEND_QUEUE)).toBe(2);
    // Clos pour de bon : pas de reprise pour un canal qui n'est pas configuré.
    expect(await runJobs(app, SEND_QUEUE)).toBe(0);

    const rows = await dbOf(app).db.select().from(notifications);
    expect(rows.filter((row) => row.status === 'skipped')).toMatchObject([
      { reason: 'not_configured' },
      { reason: 'not_configured' },
    ]);
    const skipped = logs
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((l) => l.event === 'notification.skipped');
    expect(skipped).toMatchObject([
      { level: 40, reason: 'not_configured' },
      { level: 40, reason: 'not_configured' },
    ]);
  });
});
