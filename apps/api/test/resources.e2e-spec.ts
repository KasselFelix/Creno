import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiErrorSchema, resourceSchema } from '@creno/shared';
import {
  createProviderWithResource,
  createTestApp,
  registerAs,
  resetDatabase,
  RESOURCE_INPUT,
} from './app.js';

describe('resources', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(app);
  });
  afterAll(async () => {
    await app.close();
  });

  describe('POST /v1/resources', () => {
    it('crée une ressource rattachée au profil du prestataire', async () => {
      const { provider, resource } = await createProviderWithResource(app);
      expect(resourceSchema.parse(resource)).toMatchObject({
        providerId: provider.id,
        currency: 'EUR',
        isActive: true,
        slotMinutes: 60,
      });
    });

    it('409 PROVIDER_PROFILE_REQUIRED sans profil prestataire', async () => {
      const { agent } = await registerAs(app, 'provider');
      const res = await agent.post('/v1/resources').send(RESOURCE_INPUT).expect(409);
      expect(apiErrorSchema.parse(res.body).code).toBe('PROVIDER_PROFILE_REQUIRED');
    });

    it.each([
      ['fuseau inconnu', { timezone: 'Europe/Atlantide' }],
      ['durée trop courte', { slotMinutes: 4 }],
      ['durée trop longue', { slotMinutes: 1441 }],
      ['prix négatif', { priceCents: -1 }],
      ['prix non entier', { priceCents: 45.5 }],
      ['prix payant sous le minimum de Stripe (0,50 €)', { priceCents: 49 }],
    ])('400 VALIDATION_FAILED : %s', async (_label, patch) => {
      const { agent } = await createProviderWithResource(app);
      const res = await agent
        .post('/v1/resources')
        .send({ ...RESOURCE_INPUT, ...patch })
        .expect(400);
      expect(apiErrorSchema.parse(res.body).code).toBe('VALIDATION_FAILED');
    });

    it('403 FORBIDDEN pour un client, 401 sans session', async () => {
      const { agent } = await registerAs(app, 'customer');
      await agent.post('/v1/resources').send(RESOURCE_INPUT).expect(403);
      await request(app.getHttpServer()).post('/v1/resources').send(RESOURCE_INPUT).expect(401);
    });
  });

  describe('PATCH /v1/resources/:id (propriété)', () => {
    it('le propriétaire modifie sa ressource ; un champ inconnu est ignoré', async () => {
      const { agent, resource } = await createProviderWithResource(app);
      const res = await agent
        .patch(`/v1/resources/${resource.id}`)
        .send({
          priceCents: 5000,
          slotMinutes: 30,
          providerId: '00000000-0000-4000-8000-000000000000',
        })
        .expect(200);
      expect(resourceSchema.parse(res.body)).toMatchObject({
        priceCents: 5000,
        slotMinutes: 30,
        providerId: resource.providerId,
      });
    });

    it('IDOR : un autre prestataire → 403 FORBIDDEN_OWNERSHIP, et rien ne change', async () => {
      const owner = await createProviderWithResource(app);
      const intruder = await registerAs(app, 'provider');
      await intruder.agent
        .post('/v1/providers')
        .send({
          name: 'Intrus',
          category: 'other',
          description: '',
          address: 'x',
          city: 'y',
          latitude: 0,
          longitude: 0,
        })
        .expect(201);
      const res = await intruder.agent
        .patch(`/v1/resources/${owner.resource.id}`)
        .send({ priceCents: 100 })
        .expect(403);
      expect(apiErrorSchema.parse(res.body).code).toBe('FORBIDDEN_OWNERSHIP');

      const after = await request(app.getHttpServer())
        .get(`/v1/resources/${owner.resource.id}`)
        .expect(200);
      expect(resourceSchema.parse(after.body).priceCents).toBe(4500);
    });

    it('401 sans session, 404 pour une ressource inconnue', async () => {
      const { agent, resource } = await createProviderWithResource(app);
      await request(app.getHttpServer())
        .patch(`/v1/resources/${resource.id}`)
        .send({ priceCents: 100 })
        .expect(401);
      await agent
        .patch('/v1/resources/00000000-0000-4000-8000-000000000000')
        .send({ priceCents: 100 })
        .expect(404);
    });
  });

  describe('GET /v1/resources/:id (public)', () => {
    it('renvoie une ressource active, 404 une fois désactivée', async () => {
      const { agent, resource } = await createProviderWithResource(app);
      await request(app.getHttpServer()).get(`/v1/resources/${resource.id}`).expect(200);
      await agent.patch(`/v1/resources/${resource.id}`).send({ isActive: false }).expect(200);
      const res = await request(app.getHttpServer())
        .get(`/v1/resources/${resource.id}`)
        .expect(404);
      expect(apiErrorSchema.parse(res.body).code).toBe('NOT_FOUND');
    });

    it('400 pour un identifiant mal formé', async () => {
      await request(app.getHttpServer()).get('/v1/resources/pas-un-uuid').expect(400);
    });
  });
});
