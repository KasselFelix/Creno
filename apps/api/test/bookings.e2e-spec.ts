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
  MAX_ACTIVE_HOLDS_PER_RESOURCE,
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
  RESOURCE_INPUT,
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

  it(`409 HOLD_LIMIT_REACHED au-delà de ${MAX_ACTIVE_HOLDS} holds actifs, toutes ressources confondues`, async () => {
    // Trois ressources du même prestataire : la limite par ressource (2) ne gêne pas.
    const resourceIds = [resource.id];
    for (const name of ['Studio B', 'Studio C']) {
      const created = await providerAgent
        .post('/v1/resources')
        .send({ ...RESOURCE_INPUT, name })
        .expect(201);
      const id = (created.body as Resource).id;
      await providerAgent
        .put(`/v1/resources/${id}/availability-rules`)
        .send({ rules: everyDay('09:00', '12:00') })
        .expect(200);
      resourceIds.push(id);
    }
    const { agent } = await registerAs(app, 'customer');
    const holdOn = (index: number, time: string) =>
      agent
        .post('/v1/bookings')
        .send({ resourceId: resourceIds[index], start: instantIn(DAY, time).toISOString() });

    const slots: [number, string][] = [
      [0, '09:00'],
      [0, '10:00'],
      [1, '09:00'],
      [1, '10:00'],
      [2, '09:00'],
    ];
    expect(slots).toHaveLength(MAX_ACTIVE_HOLDS);
    for (const [index, time] of slots) await holdOn(index, time).expect(201);
    const res = await holdOn(2, '10:00').expect(409);
    expect(apiErrorSchema.parse(res.body).code).toBe('HOLD_LIMIT_REACHED');
  });

  it(`409 HOLD_LIMIT_REACHED au-delà de ${MAX_ACTIVE_HOLDS_PER_RESOURCE} holds actifs sur la même ressource`, async () => {
    const { agent } = await registerAs(app, 'customer');
    await hold(agent, '09:00').expect(201);
    await hold(agent, '10:00').expect(201);
    const res = await hold(agent, '11:00').expect(409);
    expect(apiErrorSchema.parse(res.body).code).toBe('HOLD_LIMIT_REACHED');
    // Un autre client n'est pas concerné par cette limite.
    const other = await registerAs(app, 'customer');
    await hold(other.agent, '11:00').expect(201);
  });

  it('la limite de holds tient face à des demandes simultanées du même compte', async () => {
    await providerAgent
      .put(`/v1/resources/${resource.id}/availability-rules`)
      .send({ rules: everyDay('06:00', '18:00') })
      .expect(200);
    const { agent } = await registerAs(app, 'customer');
    const hours = Array.from({ length: 12 }, (_, i) => `${String(6 + i).padStart(2, '0')}:00`);
    const results = await Promise.all(hours.map((time) => hold(agent, time)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(MAX_ACTIVE_HOLDS_PER_RESOURCE);
    const refused = results.filter((r) => r.status !== 201);
    expect(refused).toHaveLength(hours.length - MAX_ACTIVE_HOLDS_PER_RESOURCE);
    expect(refused.every((r) => apiErrorSchema.parse(r.body).code === 'HOLD_LIMIT_REACHED')).toBe(
      true,
    );
    expect(await activeBookings()).toMatchObject({ rowCount: MAX_ACTIVE_HOLDS_PER_RESOURCE });
  });

  it('409 PROVIDER_PAYMENTS_NOT_READY chez un prestataire sans paiements actifs, sauf ressource gratuite', async () => {
    const pending = await createProviderWithResource(app, {}, { payments: false });
    const free = await pending.agent
      .post('/v1/resources')
      .send({ ...RESOURCE_INPUT, name: 'Visite gratuite', priceCents: 0 })
      .expect(201);
    const freeId = (free.body as Resource).id;
    await pending.agent
      .put(`/v1/resources/${freeId}/availability-rules`)
      .send({ rules: everyDay('09:00', '12:00') })
      .expect(200);
    const { agent } = await registerAs(app, 'customer');
    const start = instantIn(DAY, '10:00').toISOString();

    const res = await agent
      .post('/v1/bookings')
      .send({ resourceId: pending.resource.id, start })
      .expect(409);
    expect(apiErrorSchema.parse(res.body).code).toBe('PROVIDER_PAYMENTS_NOT_READY');
    await agent.post('/v1/bookings').send({ resourceId: freeId, start }).expect(201);
  });

  it('422 SLOT_NOT_OFFERED pour une date extrême, sans erreur serveur', async () => {
    const { agent } = await registerAs(app, 'customer');
    const res = await agent
      .post('/v1/bookings')
      .send({ resourceId: resource.id, start: '9999-12-31T23:00:00.000Z' })
      .expect(422);
    expect(apiErrorSchema.parse(res.body).code).toBe('SLOT_NOT_OFFERED');
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
