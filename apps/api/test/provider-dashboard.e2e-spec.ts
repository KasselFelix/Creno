import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bookings, resources, toRange } from '@creno/db';
import {
  apiErrorSchema,
  calendarSchema,
  type ErrorCode,
  providerBookingListSchema,
  providerStatsSchema,
  type Resource,
} from '@creno/shared';
import { wallTimeToInstant } from '../src/availability/slots.engine.js';
import {
  createProviderWithResource,
  createTestApp,
  dbOf,
  instantIn,
  localDateIn,
  registerAs,
  RESOURCE_INPUT,
  resetDatabase,
} from './app.js';

const DAY = 7;
const HOUR_MS = 3_600_000;
const TZ = RESOURCE_INPUT.timezone;

/** Premier lundi (date locale) à au moins une semaine d'aujourd'hui : toute la semaine est à venir. */
function nextMonday(): string {
  for (let days = 7; days < 14; days += 1) {
    const date = localDateIn(days);
    if (new Date(`${date}T00:00:00Z`).getUTCDay() === 1) return date;
  }
  throw new Error('inatteignable');
}

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

describe('dashboard prestataire', () => {
  let app: INestApplication;
  let provider: Awaited<ReturnType<typeof createProviderWithResource>>;
  let resource: Resource;
  let customer: Awaited<ReturnType<typeof registerAs>>;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(app);
    provider = await createProviderWithResource(app);
    resource = provider.resource;
    customer = await registerAs(app, 'customer');
  });
  afterAll(async () => {
    await app.close();
  });

  const db = () => dbOf(app).db;
  const expectCode = (res: request.Response, code: ErrorCode) =>
    expect(apiErrorSchema.parse(res.body).code).toBe(code);

  /** Réservation écrite directement en base : ces tests portent sur la lecture, pas sur le paiement. */
  async function insertBooking(
    start: Date,
    values: Partial<typeof bookings.$inferInsert> = {},
    resourceId = resource.id,
  ) {
    const [row] = await db()
      .insert(bookings)
      .values({
        resourceId,
        customerId: customer.user.id,
        during: toRange(start, new Date(start.getTime() + HOUR_MS)),
        status: 'confirmed',
        priceCents: RESOURCE_INPUT.priceCents,
        ...values,
      })
      .returning({ id: bookings.id });
    return row!.id;
  }

  const at = (date: string, time: string) => wallTimeToInstant(date, time, TZ);

  describe('GET /v1/providers/me/bookings', () => {
    it('ses réservations avec le client ; un hold est anonyme ; un hold expiré n’apparaît pas', async () => {
      const confirmed = await insertBooking(instantIn(DAY, '10:00'));
      const holdId = await insertBooking(instantIn(DAY, '11:00'), {
        status: 'pending',
        expiresAt: new Date(Date.now() + 10 * 60_000),
      });
      await insertBooking(instantIn(DAY, '09:00'), {
        status: 'pending',
        expiresAt: new Date(Date.now() - 60_000),
      });
      const cancelled = await insertBooking(instantIn(DAY + 1, '09:00'), {
        status: 'cancelled',
        confirmedAt: new Date(),
        cancelledAt: new Date(),
      });
      // Réservation d'un autre prestataire : jamais visible.
      const other = await createProviderWithResource(app);
      await insertBooking(instantIn(DAY, '10:00'), {}, other.resource.id);

      const body = providerBookingListSchema.parse(
        (await provider.agent.get('/v1/providers/me/bookings').expect(200)).body,
      );

      expect(body.total).toBe(3);
      // Tri par début croissant : 10:00, 11:00, puis le lendemain.
      expect(body.items.map((item) => item.id)).toEqual([confirmed, holdId, cancelled]);
      const byId = new Map(body.items.map((item) => [item.id, item]));
      expect(byId.get(confirmed)).toMatchObject({
        status: 'confirmed',
        resourceName: 'Studio A',
        timezone: TZ,
        customer: { fullName: expect.any(String), email: customer.user.email },
        reschedulable: true,
      });
      expect(byId.get(holdId)).toMatchObject({
        status: 'pending',
        customer: null,
        reschedulable: false,
      });
      expect(byId.get(cancelled)).toMatchObject({ status: 'cancelled', cancellableUntil: null });
    });

    it('un hold annulé par son client avant paiement n’apparaît pas (ni son client)', async () => {
      const held = await customer.agent
        .post('/v1/bookings')
        .send({ resourceId: resource.id, start: instantIn(DAY, '10:00').toISOString() })
        .expect(201);
      await customer.agent
        .post(`/v1/bookings/${(held.body as { id: string }).id}/cancel`)
        .expect(200);

      const body = providerBookingListSchema.parse(
        (await provider.agent.get('/v1/providers/me/bookings').expect(200)).body,
      );
      expect(body.total).toBe(0);
      expect(JSON.stringify(body)).not.toContain(customer.user.email);
    });

    it('passées, filtre de statut, filtre de ressource et pagination', async () => {
      const past = await insertBooking(new Date(Date.now() - 48 * HOUR_MS));
      await insertBooking(instantIn(DAY, '10:00'));
      await insertBooking(instantIn(DAY, '11:00'));
      await insertBooking(instantIn(DAY + 1, '10:00'), {
        status: 'cancelled',
        confirmedAt: new Date(),
        cancelledAt: new Date(),
      });

      const pastPage = providerBookingListSchema.parse(
        (await provider.agent.get('/v1/providers/me/bookings?scope=past').expect(200)).body,
      );
      expect(pastPage.items.map((item) => item.id)).toEqual([past]);

      const confirmedOnly = providerBookingListSchema.parse(
        (
          await provider.agent
            .get(`/v1/providers/me/bookings?status=confirmed&resourceId=${resource.id}&pageSize=1`)
            .expect(200)
        ).body,
      );
      expect(confirmedOnly.total).toBe(2);
      expect(confirmedOnly.items).toHaveLength(1);
      expect(confirmedOnly.items[0]!.status).toBe('confirmed');
    });

    it('401 anonyme, 403 client, 403 ressource d’un autre prestataire, 400 statut `expired`', async () => {
      const other = await createProviderWithResource(app);

      await request(app.getHttpServer()).get('/v1/providers/me/bookings').expect(401);
      await customer.agent.get('/v1/providers/me/bookings').expect(403);
      expectCode(
        await provider.agent
          .get(`/v1/providers/me/bookings?resourceId=${other.resource.id}`)
          .expect(403),
        'FORBIDDEN_OWNERSHIP',
      );
      await provider.agent.get('/v1/providers/me/bookings?status=expired').expect(400);
    });
  });

  describe('GET /v1/providers/me/calendar', () => {
    it('réservations confirmées et holds actifs de la plage, rien d’autre', async () => {
      const confirmed = await insertBooking(instantIn(DAY, '10:00'));
      const holdId = await insertBooking(instantIn(DAY, '11:00'), {
        status: 'pending',
        expiresAt: new Date(Date.now() + 10 * 60_000),
      });
      await insertBooking(instantIn(DAY, '09:00'), {
        status: 'cancelled',
        confirmedAt: new Date(),
        cancelledAt: new Date(),
      });
      await insertBooking(instantIn(DAY + 1, '09:00'), {
        status: 'pending',
        expiresAt: new Date(Date.now() - 60_000),
      });
      // Hors de la plage demandée.
      await insertBooking(instantIn(DAY + 3, '10:00'));

      const from = at(localDateIn(DAY), '00:00').toISOString();
      const to = at(localDateIn(DAY + 2), '00:00').toISOString();
      const body = calendarSchema.parse(
        (
          await provider.agent
            .get('/v1/providers/me/calendar')
            .query({ resourceId: resource.id, from, to })
            .expect(200)
        ).body,
      );

      expect(body.items.map((item) => item.id)).toEqual([confirmed, holdId]);
    });

    it('400 au-delà de 42 jours, 403 ressource d’un autre prestataire', async () => {
      const other = await createProviderWithResource(app);
      const from = new Date().toISOString();
      const tooFar = new Date(Date.now() + 43 * 24 * HOUR_MS).toISOString();

      await provider.agent
        .get('/v1/providers/me/calendar')
        .query({ resourceId: resource.id, from, to: tooFar })
        .expect(400);
      expectCode(
        await provider.agent
          .get('/v1/providers/me/calendar')
          .query({
            resourceId: other.resource.id,
            from,
            to: new Date(Date.now() + HOUR_MS).toISOString(),
          })
          .expect(403),
        'FORBIDDEN_OWNERSHIP',
      );
    });
  });

  describe('GET /v1/providers/me/stats', () => {
    const stats = async (weekStart: string, agent = provider.agent) =>
      providerStatsSchema.parse(
        (await agent.get('/v1/providers/me/stats').query({ weekStart }).expect(200)).body,
      );

    it('occupation et CA d’une semaine : horaires moins fermetures, réservations dans l’ouverture', async () => {
      const monday = nextMonday();
      const wednesday = addDays(monday, 2);
      // Fermeture de 3 h le mercredi, sur tout l'horaire du jour (09:00–12:00).
      await provider.agent
        .post(`/v1/resources/${resource.id}/availability-exceptions`)
        .send({ startLocal: `${wednesday}T09:00`, endLocal: `${wednesday}T12:00` })
        .expect(201);
      await insertBooking(at(monday, '10:00'));
      await insertBooking(at(addDays(monday, 4), '11:00'));
      // Sous la fermeture : comptée dans le CA (elle commence dans la semaine), pas dans l'occupation.
      await insertBooking(at(wednesday, '10:00'));
      // Ni annulée, ni hold, ni semaine suivante.
      await insertBooking(at(monday, '09:00'), {
        status: 'cancelled',
        confirmedAt: new Date(),
        cancelledAt: new Date(),
      });
      await insertBooking(at(monday, '11:00'), {
        status: 'pending',
        expiresAt: new Date(Date.now() + 10 * 60_000),
      });
      await insertBooking(at(addDays(monday, 7), '10:00'));
      // Les ressources des autres prestataires ne comptent pas.
      const other = await createProviderWithResource(app);
      await insertBooking(at(monday, '10:00'), {}, other.resource.id);

      const body = await stats(monday);

      const openMinutes = 7 * 180 - 180;
      expect(body.resources).toEqual([
        {
          resourceId: resource.id,
          name: 'Studio A',
          isActive: true,
          openMinutes,
          bookedMinutes: 120,
          occupancy: 120 / openMinutes,
          revenueCents: 3 * RESOURCE_INPUT.priceCents,
          confirmedCount: 3,
        },
      ]);
      expect(body.totals).toEqual({
        openMinutes,
        bookedMinutes: 120,
        occupancy: 120 / openMinutes,
        revenueCents: 3 * RESOURCE_INPUT.priceCents,
        confirmedCount: 3,
      });
      expect(body).toMatchObject({ weekStart: monday, currency: 'EUR' });
    });

    it('changements d’heure : un dimanche ouvert 24 h dure 25 h en octobre et 23 h en mars', async () => {
      await provider.agent
        .put(`/v1/resources/${resource.id}/availability-rules`)
        .send({ rules: [{ weekday: 7, startTime: '00:00', endTime: '24:00' }] })
        .expect(200);

      // Passage à l'heure d'hiver le dimanche 25 octobre 2026, à l'heure d'été le 28 mars 2027.
      expect((await stats('2026-10-19')).totals.openMinutes).toBe(25 * 60);
      expect((await stats('2027-03-22')).totals.openMinutes).toBe(23 * 60);
      expect((await stats('2026-10-12')).totals.openMinutes).toBe(24 * 60);
    });

    it('ressource désactivée : aucune minute ouverte, occupation `null`, CA compté', async () => {
      const monday = nextMonday();
      await insertBooking(at(monday, '10:00'));
      await db().update(resources).set({ isActive: false }).where(eq(resources.id, resource.id));

      const body = await stats(monday);

      expect(body.resources[0]).toMatchObject({
        isActive: false,
        openMinutes: 0,
        bookedMinutes: 0,
        occupancy: null,
        revenueCents: RESOURCE_INPUT.priceCents,
        confirmedCount: 1,
      });
      expect(body.totals.occupancy).toBeNull();
    });

    it('prestataire sans ressource : listes vides, totaux à zéro', async () => {
      const { agent } = await registerAs(app, 'provider');

      const body = await stats(nextMonday(), agent);

      expect(body.resources).toEqual([]);
      expect(body.totals).toEqual({
        openMinutes: 0,
        bookedMinutes: 0,
        occupancy: null,
        revenueCents: 0,
        confirmedCount: 0,
      });
    });

    it('400 si la semaine ne commence pas un lundi, 403 pour un client, 401 anonyme', async () => {
      await provider.agent
        .get('/v1/providers/me/stats')
        .query({ weekStart: '2026-10-20' })
        .expect(400);
      await customer.agent
        .get('/v1/providers/me/stats')
        .query({ weekStart: '2026-10-19' })
        .expect(403);
      await request(app.getHttpServer())
        .get('/v1/providers/me/stats')
        .query({ weekStart: '2026-10-19' })
        .expect(401);
    });
  });
});
