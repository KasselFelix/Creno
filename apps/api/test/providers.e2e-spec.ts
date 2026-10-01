import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  apiErrorSchema,
  providerSchema,
  publicProviderSchema,
  resourceListSchema,
} from '@creno/shared';
import {
  createProviderWithResource,
  createTestApp,
  PROVIDER_INPUT,
  registerAs,
  resetDatabase,
} from './app.js';

describe('providers', () => {
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

  describe('POST /v1/providers', () => {
    it('crée le profil avec un slug dérivé du nom et relit les coordonnées', async () => {
      const { agent } = await registerAs(app, 'provider');
      const res = await agent.post('/v1/providers').send(PROVIDER_INPUT).expect(201);
      const provider = providerSchema.parse(res.body);
      expect(provider.slug).toBe('studio-lumiere');
      expect(provider.latitude).toBeCloseTo(48.8644, 4);
      expect(provider.longitude).toBeCloseTo(2.3696, 4);
    });

    it('409 ALREADY_EXISTS pour un second profil sur le même compte', async () => {
      const { agent } = await registerAs(app, 'provider');
      await agent.post('/v1/providers').send(PROVIDER_INPUT).expect(201);
      const res = await agent
        .post('/v1/providers')
        .send({ ...PROVIDER_INPUT, name: 'Autre nom' })
        .expect(409);
      expect(apiErrorSchema.parse(res.body).code).toBe('ALREADY_EXISTS');
    });

    it('deux prestataires du même nom reçoivent des slugs distincts', async () => {
      const first = await registerAs(app, 'provider');
      const second = await registerAs(app, 'provider');
      await first.agent.post('/v1/providers').send(PROVIDER_INPUT).expect(201);
      const res = await second.agent.post('/v1/providers').send(PROVIDER_INPUT).expect(201);
      expect(providerSchema.parse(res.body).slug).toMatch(/^studio-lumiere-[0-9a-f]{6}$/);
    });

    it('403 FORBIDDEN pour un client, 401 sans session', async () => {
      const { agent } = await registerAs(app, 'customer');
      const res = await agent.post('/v1/providers').send(PROVIDER_INPUT).expect(403);
      expect(apiErrorSchema.parse(res.body).code).toBe('FORBIDDEN');
      await request(app.getHttpServer()).post('/v1/providers').send(PROVIDER_INPUT).expect(401);
    });

    it.each([
      ['latitude hors bornes', { latitude: 91 }],
      ['catégorie inconnue', { category: 'restaurant' }],
      ['nom vide', { name: '  ' }],
    ])('400 VALIDATION_FAILED : %s', async (_label, patch) => {
      const { agent } = await registerAs(app, 'provider');
      const res = await agent
        .post('/v1/providers')
        .send({ ...PROVIDER_INPUT, ...patch })
        .expect(400);
      expect(apiErrorSchema.parse(res.body).code).toBe('VALIDATION_FAILED');
    });
  });

  describe('GET et PATCH /v1/providers/me', () => {
    it('404 tant que le profil n’existe pas', async () => {
      const { agent } = await registerAs(app, 'provider');
      await agent.get('/v1/providers/me').expect(404);
      await agent.get('/v1/providers/me/resources').expect(404);
    });

    it('modifie le profil sans changer le slug', async () => {
      const { agent } = await createProviderWithResource(app);
      const res = await agent
        .patch('/v1/providers/me')
        .send({ name: 'Studio Ombre', longitude: 2.4 })
        .expect(200);
      const provider = providerSchema.parse(res.body);
      expect(provider).toMatchObject({ name: 'Studio Ombre', slug: 'studio-lumiere' });
      expect(provider.longitude).toBeCloseTo(2.4, 4);
      expect(provider.latitude).toBeCloseTo(48.8644, 4);
    });

    it('liste les ressources du prestataire, inactives comprises', async () => {
      const { agent, resource } = await createProviderWithResource(app);
      await agent.patch(`/v1/resources/${resource.id}`).send({ isActive: false }).expect(200);
      const res = await agent.get('/v1/providers/me/resources').expect(200);
      const { items } = resourceListSchema.parse(res.body);
      expect(items).toHaveLength(1);
      expect(items[0]!.isActive).toBe(false);
    });
  });

  describe('GET /v1/providers/:slug (public)', () => {
    it('renvoie la fiche et ses ressources actives, sans donnée interne', async () => {
      const { agent, resource } = await createProviderWithResource(app);
      const hidden = await agent
        .post('/v1/resources')
        .send({
          name: 'Studio B',
          description: '',
          timezone: 'Europe/Paris',
          slotMinutes: 30,
          priceCents: 0,
        })
        .expect(201);
      await agent
        .patch(`/v1/resources/${(hidden.body as { id: string }).id}`)
        .send({ isActive: false })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/v1/providers/studio-lumiere')
        .expect(200);
      const fiche = publicProviderSchema.parse(res.body);
      expect(fiche.resources.map((r) => r.id)).toEqual([resource.id]);
      expect(res.body).not.toHaveProperty('userId');
      expect(res.body).not.toHaveProperty('stripeAccountId');
    });

    it('404 pour un slug inconnu', async () => {
      const res = await request(app.getHttpServer()).get('/v1/providers/inconnu').expect(404);
      expect(apiErrorSchema.parse(res.body).code).toBe('NOT_FOUND');
    });
  });
});
