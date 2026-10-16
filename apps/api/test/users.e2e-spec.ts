import { createHmac } from 'node:crypto';
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

  it.each([
    ['signé avec un autre secret', 'HS256', 'un-autre-secret-un-autre-secret-0000'],
    ['sans signature (alg none)', 'none', null],
  ])('401 avec un access token falsifié : %s', async (_label, alg, secret) => {
    // Construit à l'exécution : un JWT écrit en dur déclencherait le scan de secrets (gitleaks).
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg, typ: 'JWT' })}.${encode({ sub: '1', role: 'admin', sid: '1', iss: 'creno-api' })}`;
    const signature = secret
      ? createHmac('sha256', secret).update(unsigned).digest('base64url')
      : '';
    await request(app.getHttpServer())
      .get('/v1/users/me')
      .set('Authorization', `Bearer ${unsigned}.${signature}`)
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
    it('met à jour le nom', async () => {
      const { agent } = await registerAs(app);
      const res = await agent.patch('/v1/users/me').send({ fullName: 'Léa P.' }).expect(200);
      expect(publicUserSchema.parse(res.body)).toMatchObject({ fullName: 'Léa P.', phone: null });
    });

    it('refuse le téléphone (il passe par un code SMS) et tout autre champ, comme le rôle', async () => {
      const { agent, user } = await registerAs(app);
      await agent.patch('/v1/users/me').send({ phone: '+33612345678' }).expect(400);
      await agent.patch('/v1/users/me').send({ phone: null }).expect(400);
      await agent.patch('/v1/users/me').send({ fullName: 'X', role: 'admin' }).expect(400);
      const res = await agent.get('/v1/users/me').expect(200);
      expect(publicUserSchema.parse(res.body)).toMatchObject({
        id: user.id,
        phone: null,
        role: 'customer',
      });
    });
  });

  it('sans passerelle SMS (démo sans Twilio) : 503 SMS_UNAVAILABLE, rien n’est enregistré', async () => {
    const { agent } = await registerAs(app);
    const res = await agent.post('/v1/users/me/phone').send({ phone: '+33612345678' }).expect(503);
    expect(apiErrorSchema.parse(res.body).code).toBe('SMS_UNAVAILABLE');
    const me = await agent.get('/v1/users/me').expect(200);
    expect(publicUserSchema.parse(me.body).phone).toBeNull();
  });
});
