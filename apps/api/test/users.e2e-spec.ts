import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiErrorSchema, publicUserSchema, userListSchema } from '@creno/shared';
import { createTestApp, loginAsAdmin, registerAs, resetDatabase } from './app.js';

describe('users', () => {
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

  it('401 UNAUTHORIZED sans être connecté', async () => {
    const res = await request(app.getHttpServer()).get('/v1/users/me').expect(401);
    expect(apiErrorSchema.parse(res.body).code).toBe('UNAUTHORIZED');
  });

  it('401 avec un access token falsifié', async () => {
    const forged =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIiwicm9sZSI6ImFkbWluIiwic2lkIjoiMSJ9.c2lnbmF0dXJlLWZhdXNzZQ';
    await request(app.getHttpServer())
      .get('/v1/users/me')
      .set('Authorization', `Bearer ${forged}`)
      .expect(401);
  });

  describe('GET /v1/users/:id (propriété)', () => {
    it('un utilisateur lit son propre compte', async () => {
      const { agent, user } = await registerAs(app);
      const res = await agent.get(`/v1/users/${user.id}`).expect(200);
      expect(publicUserSchema.parse(res.body).id).toBe(user.id);
    });

    it('IDOR : un client qui lit le compte d’un autre → 403 FORBIDDEN_OWNERSHIP', async () => {
      const alice = await registerAs(app, 'customer');
      const bob = await registerAs(app, 'provider');
      const res = await alice.agent.get(`/v1/users/${bob.user.id}`).expect(403);
      expect(apiErrorSchema.parse(res.body).code).toBe('FORBIDDEN_OWNERSHIP');
    });

    it('le 403 ne dépend pas de l’existence de l’id (pas d’énumération)', async () => {
      const alice = await registerAs(app);
      await alice.agent.get('/v1/users/00000000-0000-4000-8000-000000000000').expect(403);
    });

    it('un admin lit n’importe quel compte, 404 si inconnu', async () => {
      const bob = await registerAs(app);
      const admin = await loginAsAdmin(app);
      await admin.agent.get(`/v1/users/${bob.user.id}`).expect(200);
      await admin.agent.get('/v1/users/00000000-0000-4000-8000-000000000000').expect(404);
    });
  });

  describe('GET /v1/users (rôle admin)', () => {
    it.each(['customer', 'provider'] as const)('403 FORBIDDEN pour un %s', async (role) => {
      const { agent } = await registerAs(app, role);
      const res = await agent.get('/v1/users').expect(403);
      expect(apiErrorSchema.parse(res.body).code).toBe('FORBIDDEN');
    });

    it('200 pour un admin, paginé', async () => {
      await registerAs(app);
      await registerAs(app);
      const admin = await loginAsAdmin(app);
      const res = await admin.agent.get('/v1/users?page=1&pageSize=2').expect(200);
      const body = userListSchema.parse(res.body);
      expect(body.total).toBe(3);
      expect(body.items).toHaveLength(2);
    });

    it('400 pour une pagination invalide', async () => {
      const admin = await loginAsAdmin(app);
      await admin.agent.get('/v1/users?pageSize=1000').expect(400);
    });
  });

  describe('PATCH /v1/users/me', () => {
    it('met à jour le nom et le téléphone', async () => {
      const { agent } = await registerAs(app);
      const res = await agent
        .patch('/v1/users/me')
        .send({ fullName: 'Léa P.', phone: '+33612345678' })
        .expect(200);
      expect(publicUserSchema.parse(res.body)).toMatchObject({
        fullName: 'Léa P.',
        phone: '+33612345678',
      });
    });

    it('refuse un téléphone mal formé et ignore un changement de rôle', async () => {
      const { agent } = await registerAs(app);
      await agent.patch('/v1/users/me').send({ phone: '0612345678' }).expect(400);
      const res = await agent
        .patch('/v1/users/me')
        .send({ fullName: 'X', role: 'admin' })
        .expect(200);
      expect(publicUserSchema.parse(res.body).role).toBe('customer');
    });
  });
});
