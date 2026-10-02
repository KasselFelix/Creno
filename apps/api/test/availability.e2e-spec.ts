import type { INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { availabilityExceptions, availabilityRules, bookings, sqlState, toRange } from '@creno/db';
import {
  apiErrorSchema,
  availabilityExceptionSchema,
  exceptionListSchema,
  MAX_UPCOMING_EXCEPTIONS,
  rulesResponseSchema,
  slotsResponseSchema,
} from '@creno/shared';
import {
  createProviderWithResource,
  createTestApp,
  dbOf,
  everyDay,
  instantIn,
  localDateIn,
  PROVIDER_INPUT,
  registerAs,
  resetDatabase,
} from './app.js';

const DAY = 7;

describe('availability', () => {
  let app: INestApplication;
  const anonymous = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(app);
  });
  afterAll(async () => {
    await app.close();
  });

  async function slotsOf(resourceId: string, from = localDateIn(DAY), to = from) {
    const res = await anonymous()
      .get(`/v1/resources/${resourceId}/slots?from=${from}&to=${to}`)
      .expect(200);
    return slotsResponseSchema.parse(res.body);
  }

  async function insertBooking(
    resourceId: string,
    customerId: string,
    time: string,
    status: 'pending' | 'confirmed' | 'cancelled',
    expiresInMinutes?: number,
  ) {
    const start = instantIn(DAY, time);
    await dbOf(app)
      .db.insert(bookings)
      .values({
        resourceId,
        customerId,
        during: toRange(start, new Date(start.getTime() + 60 * 60_000)),
        status,
        cancelledAt: status === 'cancelled' ? new Date() : null,
        expiresAt:
          expiresInMinutes === undefined
            ? null
            : sql`now() + make_interval(mins => ${expiresInMinutes})`,
        priceCents: 4500,
      });
  }

  describe('PUT /v1/resources/:id/availability-rules', () => {
    it('remplace tout l’horaire et le renvoie trié', async () => {
      const { agent, resource } = await createProviderWithResource(app);
      const rules = [
        { weekday: 2, startTime: '14:00', endTime: '24:00' },
        { weekday: 2, startTime: '09:00', endTime: '12:00' },
        { weekday: 1, startTime: '09:00', endTime: '12:00' },
      ];
      const res = await agent
        .put(`/v1/resources/${resource.id}/availability-rules`)
        .send({ rules })
        .expect(200);
      expect(rulesResponseSchema.parse(res.body).rules).toEqual([rules[2], rules[1], rules[0]]);

      const read = await agent.get(`/v1/resources/${resource.id}/availability-rules`).expect(200);
      expect(rulesResponseSchema.parse(read.body).rules).toHaveLength(3);
    });

    it('un horaire vide ferme la ressource', async () => {
      const { agent, resource } = await createProviderWithResource(app);
      await agent
        .put(`/v1/resources/${resource.id}/availability-rules`)
        .send({ rules: [] })
        .expect(200);
      const { days } = await slotsOf(resource.id);
      expect(days[0]!.slots).toEqual([]);
    });

    it('400 pour des plages qui se chevauchent, et l’ancien horaire est conservé', async () => {
      const { agent, resource } = await createProviderWithResource(app);
      const res = await agent
        .put(`/v1/resources/${resource.id}/availability-rules`)
        .send({
          rules: [
            { weekday: 1, startTime: '09:00', endTime: '12:00' },
            { weekday: 1, startTime: '11:00', endTime: '14:00' },
          ],
        })
        .expect(400);
      expect(apiErrorSchema.parse(res.body).code).toBe('VALIDATION_FAILED');
      const read = await agent.get(`/v1/resources/${resource.id}/availability-rules`);
      expect(rulesResponseSchema.parse(read.body).rules).toHaveLength(7);
    });

    it('la base refuse elle-même le chevauchement (23P01), sans passer par l’API', async () => {
      const { resource } = await createProviderWithResource(app);
      const error = await dbOf(app)
        .db.insert(availabilityRules)
        .values({ resourceId: resource.id, weekday: 1, startTime: '11:00', endTime: '14:00' })
        .then(
          () => undefined,
          (e: unknown) => e,
        );
      expect(sqlState(error)).toBe('23P01');
    });

    it('IDOR : 403 FORBIDDEN_OWNERSHIP pour un autre prestataire, 401 sans session', async () => {
      const owner = await createProviderWithResource(app);
      const intruder = await registerAs(app, 'provider');
      await intruder.agent
        .post('/v1/providers')
        .send({ ...PROVIDER_INPUT, name: 'Intrus' })
        .expect(201);
      const url = `/v1/resources/${owner.resource.id}`;

      const put = await intruder.agent
        .put(`${url}/availability-rules`)
        .send({ rules: [] })
        .expect(403);
      expect(apiErrorSchema.parse(put.body).code).toBe('FORBIDDEN_OWNERSHIP');
      await intruder.agent.get(`${url}/availability-rules`).expect(403);
      await anonymous().get(`${url}/availability-rules`).expect(401);
      await intruder.agent.get(`${url}/availability-exceptions`).expect(403);
      await intruder.agent
        .post(`${url}/availability-exceptions`)
        .send({
          startLocal: `${localDateIn(DAY)}T00:00`,
          endLocal: `${localDateIn(DAY + 1)}T00:00`,
        })
        .expect(403);
      await anonymous().put(`${url}/availability-rules`).send({ rules: [] }).expect(401);

      const read = await owner.agent.get(`${url}/availability-rules`);
      expect(rulesResponseSchema.parse(read.body).rules).toHaveLength(7);
    });
  });

  describe('fermetures', () => {
    it('crée une fermeture en heure locale de la ressource, la liste et la supprime', async () => {
      const { agent, resource } = await createProviderWithResource(app);
      const url = `/v1/resources/${resource.id}/availability-exceptions`;
      const date = localDateIn(DAY);
      const created = await agent
        .post(url)
        .send({ startLocal: `${date}T10:00`, endLocal: `${date}T11:00`, reason: 'Livraison' })
        .expect(201);
      const exception = availabilityExceptionSchema.parse(created.body);
      expect(exception.start).toBe(instantIn(DAY, '10:00').toISOString());
      expect(exception.end).toBe(instantIn(DAY, '11:00').toISOString());

      const list = await agent.get(url).expect(200);
      expect(exceptionListSchema.parse(list.body).items).toEqual([exception]);

      const { days } = await slotsOf(resource.id);
      expect(days[0]!.slots.map((s) => s.start)).toEqual([
        instantIn(DAY, '09:00').toISOString(),
        instantIn(DAY, '11:00').toISOString(),
      ]);

      await agent.delete(`${url}/${exception.id}`).expect(204);
      await agent.delete(`${url}/${exception.id}`).expect(404);
      expect((await slotsOf(resource.id)).days[0]!.slots).toHaveLength(3);
    });

    it('400 si la fin précède le début', async () => {
      const { agent, resource } = await createProviderWithResource(app);
      const date = localDateIn(DAY);
      await agent
        .post(`/v1/resources/${resource.id}/availability-exceptions`)
        .send({ startLocal: `${date}T11:00`, endLocal: `${date}T10:00` })
        .expect(400);
    });

    it(`409 LIMIT_REACHED au-delà de ${MAX_UPCOMING_EXCEPTIONS} fermetures à venir`, async () => {
      const { agent, resource } = await createProviderWithResource(app);
      const start = instantIn(DAY, '00:00');
      await dbOf(app)
        .db.insert(availabilityExceptions)
        .values(
          Array.from({ length: MAX_UPCOMING_EXCEPTIONS }, () => ({
            resourceId: resource.id,
            during: toRange(start, new Date(start.getTime() + 60_000)),
          })),
        );
      const date = localDateIn(DAY);
      const res = await agent
        .post(`/v1/resources/${resource.id}/availability-exceptions`)
        .send({ startLocal: `${date}T10:00`, endLocal: `${date}T11:00` })
        .expect(409);
      expect(apiErrorSchema.parse(res.body).code).toBe('LIMIT_REACHED');
    });

    it('la fermeture d’une ressource ne se supprime pas via une autre ressource', async () => {
      const owner = await createProviderWithResource(app);
      const date = localDateIn(DAY);
      const created = await owner.agent
        .post(`/v1/resources/${owner.resource.id}/availability-exceptions`)
        .send({ startLocal: `${date}T10:00`, endLocal: `${date}T11:00` })
        .expect(201);
      const exceptionId = (created.body as { id: string }).id;

      const other = await createProviderWithResource(app);
      await other.agent
        .delete(`/v1/resources/${other.resource.id}/availability-exceptions/${exceptionId}`)
        .expect(404);
      await other.agent
        .delete(`/v1/resources/${owner.resource.id}/availability-exceptions/${exceptionId}`)
        .expect(403);
      const list = await owner.agent.get(
        `/v1/resources/${owner.resource.id}/availability-exceptions`,
      );
      expect(exceptionListSchema.parse(list.body).items).toHaveLength(1);
    });
  });

  describe('GET /v1/resources/:id/slots (public)', () => {
    it('renvoie les créneaux par jour local, bornes [début, fin), avec le prix', async () => {
      const { resource } = await createProviderWithResource(app);
      const body = await slotsOf(resource.id, localDateIn(DAY), localDateIn(DAY + 1));
      expect(body).toMatchObject({
        resourceId: resource.id,
        timezone: 'Europe/Paris',
        slotMinutes: 60,
        priceCents: 4500,
        currency: 'EUR',
      });
      expect(body.days.map((d) => d.date)).toEqual([localDateIn(DAY), localDateIn(DAY + 1)]);
      expect(body.days[0]!.slots).toEqual([
        {
          start: instantIn(DAY, '09:00').toISOString(),
          end: instantIn(DAY, '10:00').toISOString(),
          available: true,
        },
        {
          start: instantIn(DAY, '10:00').toISOString(),
          end: instantIn(DAY, '11:00').toISOString(),
          available: true,
        },
        {
          start: instantIn(DAY, '11:00').toISOString(),
          end: instantIn(DAY, '12:00').toISOString(),
          available: true,
        },
      ]);
    });

    it('ne propose aucun créneau passé', async () => {
      const { agent, resource } = await createProviderWithResource(app);
      await agent
        .put(`/v1/resources/${resource.id}/availability-rules`)
        .send({ rules: everyDay('00:00', '24:00') })
        .expect(200);
      const now = Date.now();
      const { days } = await slotsOf(resource.id, localDateIn(-1), localDateIn(0));
      expect(days[0]!.slots).toEqual([]);
      expect(days[1]!.slots.every((slot) => Date.parse(slot.start) > now)).toBe(true);
    });

    it('marque available: false un créneau confirmé ou sous hold actif, pas un créneau annulé', async () => {
      const { resource } = await createProviderWithResource(app);
      const customer = await registerAs(app, 'customer');
      await insertBooking(resource.id, customer.user.id, '09:00', 'confirmed');
      await insertBooking(resource.id, customer.user.id, '10:00', 'pending', 15);
      await insertBooking(resource.id, customer.user.id, '11:00', 'cancelled');
      const { days } = await slotsOf(resource.id);
      expect(days[0]!.slots.map((s) => s.available)).toEqual([false, false, true]);
    });

    it('ignore un hold expiré : le créneau redevient disponible sans attendre le nettoyage', async () => {
      const { resource } = await createProviderWithResource(app);
      const customer = await registerAs(app, 'customer');
      await insertBooking(resource.id, customer.user.id, '10:00', 'pending', -1);
      const { days } = await slotsOf(resource.id);
      expect(days[0]!.slots.map((s) => s.available)).toEqual([true, true, true]);
    });

    it('404 pour une ressource inconnue ou désactivée', async () => {
      const { agent, resource } = await createProviderWithResource(app);
      const query = `from=${localDateIn(DAY)}&to=${localDateIn(DAY)}`;
      await anonymous()
        .get(`/v1/resources/00000000-0000-4000-8000-000000000000/slots?${query}`)
        .expect(404);
      await agent.patch(`/v1/resources/${resource.id}`).send({ isActive: false }).expect(200);
      await anonymous().get(`/v1/resources/${resource.id}/slots?${query}`).expect(404);
    });

    it.each([
      ['plage inversée', `from=${localDateIn(2)}&to=${localDateIn(1)}`],
      ['plus de 31 jours', `from=${localDateIn(0)}&to=${localDateIn(31)}`],
      ['date mal formée', 'from=demain&to=demain'],
      ['année extrême', 'from=9999-12-31&to=9999-12-31'],
      ['paramètre manquant', `from=${localDateIn(1)}`],
    ])('400 VALIDATION_FAILED : %s', async (_label, query) => {
      const { resource } = await createProviderWithResource(app);
      const res = await anonymous().get(`/v1/resources/${resource.id}/slots?${query}`).expect(400);
      expect(apiErrorSchema.parse(res.body).code).toBe('VALIDATION_FAILED');
    });
  });

  describe('limite de débit des lectures publiques', () => {
    it('429 TOO_MANY_REQUESTS au-delà de la limite par minute', async () => {
      const limited = await createTestApp({ publicRateLimit: 3 });
      try {
        const { resource } = await createProviderWithResource(limited);
        const url = `/v1/resources/${resource.id}/slots?from=${localDateIn(DAY)}&to=${localDateIn(DAY)}`;
        for (let i = 0; i < 3; i++) await request(limited.getHttpServer()).get(url).expect(200);
        const res = await request(limited.getHttpServer()).get(url).expect(429);
        expect(apiErrorSchema.parse(res.body).code).toBe('TOO_MANY_REQUESTS');
      } finally {
        await limited.close();
      }
    });
  });
});
