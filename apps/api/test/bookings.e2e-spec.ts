import type { INestApplication } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bookings, toRange } from '@creno/db';
import {
  apiErrorSchema,
  bookingSchema,
  HOLD_MINUTES,
  MAX_ACTIVE_HOLDS,
  type Resource,
  slotsResponseSchema,
} from '@creno/shared';
import {
  createProviderWithResource,
  createTestApp,
  dbOf,
  everyDay,
  instantIn,
  localDateIn,
  registerAs,
  resetDatabase,
} from './app.js';

const DAY = 7;
const HOUR = 60 * 60_000;

describe('bookings (hold de paiement)', () => {
  let app: INestApplication;
  let resource: Resource;
  let providerAgent: Awaited<ReturnType<typeof createProviderWithResource>>['agent'];

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(app);
    ({ resource, agent: providerAgent } = await createProviderWithResource(app));
  });
  afterAll(async () => {
    await app.close();
  });

  const hold = (agent: request.Agent, time: string, day = DAY) =>
    agent
      .post('/v1/bookings')
      .send({ resourceId: resource.id, start: instantIn(day, time).toISOString() });

  const activeBookings = () =>
    dbOf(app).db.execute<{ status: string }>(
      sql`SELECT status FROM bookings WHERE status IN ('pending', 'confirmed')`,
    );

  it('201 : bloque le créneau 15 minutes, au prix de la ressource', async () => {
    const { agent } = await registerAs(app, 'customer');
    const before = Date.now();
    const res = await hold(agent, '10:00').send({ priceCents: 1 }).expect(201);
    const booking = bookingSchema.parse(res.body);
    expect(booking).toMatchObject({
      resourceId: resource.id,
      start: instantIn(DAY, '10:00').toISOString(),
      end: instantIn(DAY, '11:00').toISOString(),
      status: 'pending',
      priceCents: 4500,
      currency: 'EUR',
    });
    const expiresIn = Date.parse(booking.expiresAt!) - before;
    expect(expiresIn).toBeGreaterThan((HOLD_MINUTES - 1) * 60_000);
    expect(expiresIn).toBeLessThan((HOLD_MINUTES + 1) * 60_000);

    const slots = await request(app.getHttpServer())
      .get(`/v1/resources/${resource.id}/slots?from=${localDateIn(DAY)}&to=${localDateIn(DAY)}`)
      .expect(200);
    expect(slotsResponseSchema.parse(slots.body).days[0]!.slots.map((s) => s.available)).toEqual([
      true,
      false,
      true,
    ]);
  });

  it('409 SLOT_UNAVAILABLE sur un créneau déjà tenu', async () => {
    const first = await registerAs(app, 'customer');
    const second = await registerAs(app, 'customer');
    await hold(first.agent, '10:00').expect(201);
    const res = await hold(second.agent, '10:00').expect(409);
    expect(apiErrorSchema.parse(res.body).code).toBe('SLOT_UNAVAILABLE');
  });

  // Test obligatoire : c'est la contrainte EXCLUDE de la base qui départage, pas un contrôle applicatif.
  it('concurrence : deux réservations simultanées du même créneau → exactement un 201 et un 409', async () => {
    const alice = await registerAs(app, 'customer');
    const bob = await registerAs(app, 'customer');
    for (let run = 0; run < 10; run++) {
      await dbOf(app).db.delete(bookings);
      const results = await Promise.all([hold(alice.agent, '10:00'), hold(bob.agent, '10:00')]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      const loser = results.find((r) => r.status === 409)!;
      expect(apiErrorSchema.parse(loser.body).code).toBe('SLOT_UNAVAILABLE');
      expect(await activeBookings()).toMatchObject({ rowCount: 1 });
    }
  });

  it('concurrence : cinq clients sur le même créneau → un seul 201', async () => {
    const customers = await Promise.all(
      Array.from({ length: 5 }, () => registerAs(app, 'customer')),
    );
    const results = await Promise.all(customers.map(({ agent }) => hold(agent, '09:00')));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
    expect(await activeBookings()).toMatchObject({ rowCount: 1 });
  });

  it('un hold expiré ne bloque plus : 201, et l’ancien hold passe à expired', async () => {
    const first = await registerAs(app, 'customer');
    const second = await registerAs(app, 'customer');
    const start = instantIn(DAY, '10:00');
    const [stale] = await dbOf(app)
      .db.insert(bookings)
      .values({
        resourceId: resource.id,
        customerId: first.user.id,
        during: toRange(start, new Date(start.getTime() + HOUR)),
        status: 'pending',
        expiresAt: sql`now() - interval '1 minute'`,
        priceCents: 4500,
      })
      .returning({ id: bookings.id });

    await hold(second.agent, '10:00').expect(201);
    const [row] = await dbOf(app)
      .db.select({ status: bookings.status })
      .from(bookings)
      .where(eq(bookings.id, stale!.id));
    expect(row!.status).toBe('expired');
  });

  it('un hold expiré sur un autre créneau n’est pas touché', async () => {
    const first = await registerAs(app, 'customer');
    const start = instantIn(DAY, '09:00');
    const [stale] = await dbOf(app)
      .db.insert(bookings)
      .values({
        resourceId: resource.id,
        customerId: first.user.id,
        during: toRange(start, new Date(start.getTime() + HOUR)),
        status: 'pending',
        expiresAt: sql`now() - interval '1 minute'`,
        priceCents: 4500,
      })
      .returning({ id: bookings.id });
    await hold(first.agent, '11:00').expect(201);
    const [row] = await dbOf(app)
      .db.select({ status: bookings.status })
      .from(bookings)
      .where(eq(bookings.id, stale!.id));
    expect(row!.status).toBe('pending');
  });

  it.each([
    ['hors grille', '10:30', DAY],
    ['hors horaires', '14:00', DAY],
    ['passé', '10:00', -1],
    ['au-delà de l’horizon', '10:00', 120],
  ])('422 SLOT_NOT_OFFERED : créneau %s', async (_label, time, day) => {
    const { agent } = await registerAs(app, 'customer');
    const res = await hold(agent, time, day).expect(422);
    expect(apiErrorSchema.parse(res.body).code).toBe('SLOT_NOT_OFFERED');
    expect(await activeBookings()).toMatchObject({ rowCount: 0 });
  });

  it('422 SLOT_NOT_OFFERED pendant une fermeture', async () => {
    const date = localDateIn(DAY);
    await providerAgent
      .post(`/v1/resources/${resource.id}/availability-exceptions`)
      .send({ startLocal: `${date}T00:00`, endLocal: `${localDateIn(DAY + 1)}T00:00` })
      .expect(201);
    const { agent } = await registerAs(app, 'customer');
    const res = await hold(agent, '10:00').expect(422);
    expect(apiErrorSchema.parse(res.body).code).toBe('SLOT_NOT_OFFERED');
  });

  it(`409 HOLD_LIMIT_REACHED au-delà de ${MAX_ACTIVE_HOLDS} holds actifs`, async () => {
    await providerAgent
      .put(`/v1/resources/${resource.id}/availability-rules`)
      .send({ rules: everyDay('09:00', '18:00') })
      .expect(200);
    const { agent } = await registerAs(app, 'customer');
    for (let hour = 9; hour < 9 + MAX_ACTIVE_HOLDS; hour++) {
      await hold(agent, `${String(hour).padStart(2, '0')}:00`).expect(201);
    }
    const res = await hold(agent, '16:00').expect(409);
    expect(apiErrorSchema.parse(res.body).code).toBe('HOLD_LIMIT_REACHED');
  });

  it('404 pour une ressource inconnue ou désactivée', async () => {
    const { agent } = await registerAs(app, 'customer');
    await agent
      .post('/v1/bookings')
      .send({
        resourceId: '00000000-0000-4000-8000-000000000000',
        start: instantIn(DAY, '10:00').toISOString(),
      })
      .expect(404);
    await providerAgent.patch(`/v1/resources/${resource.id}`).send({ isActive: false }).expect(200);
    await hold(agent, '10:00').expect(404);
  });

  it('401 sans session, 400 pour un corps invalide', async () => {
    await hold(request.agent(app.getHttpServer()), '10:00').expect(401);
    const { agent } = await registerAs(app, 'customer');
    const res = await agent
      .post('/v1/bookings')
      .send({ resourceId: resource.id, start: 'demain 10h' })
      .expect(400);
    expect(apiErrorSchema.parse(res.body).code).toBe('VALIDATION_FAILED');
  });
});
