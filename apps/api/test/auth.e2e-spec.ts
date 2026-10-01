import type { INestApplication } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sessions, users } from '@creno/db';
import { AUTH_COOKIES, apiErrorSchema, authResponseSchema, sessionListSchema } from '@creno/shared';
import {
  cookieValue,
  createTestApp,
  dbOf,
  registerAs,
  resetDatabase,
  setCookieLine,
  TEST_PASSWORD,
  uniqueEmail,
  WEB_ORIGIN,
} from './app.js';

describe('auth', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(app);
  });
  afterAll(async () => {
    await app.close();
  });

  describe('POST /v1/auth/register', () => {
    it('crée le compte, pose les cookies HttpOnly et connecte l’utilisateur', async () => {
      const email = uniqueEmail();
      const agent = request.agent(app.getHttpServer());
      const res = await agent
        .post('/v1/auth/register')
        .send({ email, password: TEST_PASSWORD, fullName: 'Léa Petit', role: 'provider' })
        .expect(201);

      const { user } = authResponseSchema.parse(res.body);
      expect(user).toMatchObject({ email, fullName: 'Léa Petit', role: 'provider', phone: null });
      expect(JSON.stringify(res.body)).not.toMatch(/hash|password/i);
      expect(setCookieLine(res, AUTH_COOKIES.access)).toMatch(/HttpOnly/i);
      expect(setCookieLine(res, AUTH_COOKIES.access)).toMatch(/SameSite=Lax/i);
      expect(setCookieLine(res, AUTH_COOKIES.refresh)).toMatch(
        /HttpOnly.*SameSite=Strict|SameSite=Strict.*HttpOnly/i,
      );

      const me = await agent.get('/v1/users/me').expect(200);
      expect(me.body).toMatchObject({ id: user.id, email });
    });

    it('refuse un email déjà pris, casse différente comprise (409 EMAIL_TAKEN)', async () => {
      const email = uniqueEmail();
      await http()
        .post('/v1/auth/register')
        .send({ email, password: TEST_PASSWORD, fullName: 'A', role: 'customer' });
      const res = await http()
        .post('/v1/auth/register')
        .send({
          email: email.toUpperCase(),
          password: TEST_PASSWORD,
          fullName: 'B',
          role: 'customer',
        })
        .expect(409);
      expect(apiErrorSchema.parse(res.body).code).toBe('EMAIL_TAKEN');
    });

    it.each([
      ['mot de passe trop court', { password: 'court' }, 'password'],
      ['email invalide', { email: 'pas-un-email' }, 'email'],
      ['rôle admin', { role: 'admin' }, 'role'],
    ])('400 VALIDATION_FAILED : %s', async (_label, patch, field) => {
      const res = await http()
        .post('/v1/auth/register')
        .send({
          email: uniqueEmail(),
          password: TEST_PASSWORD,
          fullName: 'X',
          role: 'customer',
          ...patch,
        })
        .expect(400);
      const body = apiErrorSchema.parse(res.body);
      expect(body.code).toBe('VALIDATION_FAILED');
      expect(body.details).toMatchObject({ fieldErrors: { [field]: expect.any(Array) } });
    });
  });

  describe('POST /v1/auth/login', () => {
    it('connecte avec le bon mot de passe', async () => {
      const { user } = await registerAs(app);
      const res = await http()
        .post('/v1/auth/login')
        .send({ email: user.email, password: TEST_PASSWORD })
        .expect(200);
      expect(authResponseSchema.parse(res.body).user.id).toBe(user.id);
      expect(cookieValue(res, AUTH_COOKIES.access)).toBeTruthy();
      expect(cookieValue(res, AUTH_COOKIES.refresh)).toBeTruthy();
    });

    it('purge les sessions expirées ou révoquées de l’utilisateur à la connexion', async () => {
      const { agent, user } = await registerAs(app);
      const login = () =>
        http().post('/v1/auth/login').send({ email: user.email, password: TEST_PASSWORD });
      const expired = cookieValue(await login(), AUTH_COOKIES.refresh)!.split('.')[0]!;
      await dbOf(app)
        .db.update(sessions)
        .set({
          expiresAt: sql`now() - interval '1 second'`,
          createdAt: sql`now() - interval '1 day'`,
        })
        .where(eq(sessions.id, expired));
      await agent.post('/v1/auth/logout').expect(204); // session d'inscription révoquée

      await login().expect(200);

      const rows = await dbOf(app)
        .db.select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.userId, user.id));
      expect(rows).toHaveLength(1);
    });

    it('même 401 INVALID_CREDENTIALS pour un mauvais mot de passe et un email inconnu', async () => {
      const { user } = await registerAs(app);
      const wrongPassword = await http()
        .post('/v1/auth/login')
        .send({ email: user.email, password: 'mauvais-mot-de-passe' })
        .expect(401);
      const unknownEmail = await http()
        .post('/v1/auth/login')
        .send({ email: uniqueEmail('inconnu'), password: TEST_PASSWORD })
        .expect(401);
      expect(wrongPassword.body).toEqual(unknownEmail.body);
      expect(apiErrorSchema.parse(wrongPassword.body).code).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('POST /v1/auth/refresh (rotation)', () => {
    async function loginFresh() {
      const { user } = await registerAs(app);
      const res = await http()
        .post('/v1/auth/login')
        .send({ email: user.email, password: TEST_PASSWORD });
      return { user, refreshToken: cookieValue(res, AUTH_COOKIES.refresh)! };
    }
    const refreshWith = (token: string) =>
      http().post('/v1/auth/refresh').set('Cookie', `${AUTH_COOKIES.refresh}=${token}`);

    it('échange le refresh token contre un nouveau', async () => {
      const { refreshToken } = await loginFresh();
      const res = await refreshWith(refreshToken).expect(200);
      const next = cookieValue(res, AUTH_COOKIES.refresh);
      expect(next).toBeTruthy();
      expect(next).not.toBe(refreshToken);
      expect(cookieValue(res, AUTH_COOKIES.access)).toBeTruthy();
      await refreshWith(next!).expect(200);
    });

    it('accepte l’ancien token pendant le délai de grâce, sans nouveau refresh token', async () => {
      const { refreshToken } = await loginFresh();
      await refreshWith(refreshToken).expect(200);
      const res = await refreshWith(refreshToken).expect(200);
      expect(cookieValue(res, AUTH_COOKIES.access)).toBeTruthy();
      expect(cookieValue(res, AUTH_COOKIES.refresh)).toBeUndefined();
    });

    it('détecte la réutilisation après le délai de grâce et révoque toute la session', async () => {
      const { refreshToken } = await loginFresh();
      const rotated = cookieValue(
        await refreshWith(refreshToken).expect(200),
        AUTH_COOKIES.refresh,
      )!;
      // Simule le passage du délai de grâce de 10 s.
      const sessionId = refreshToken.split('.')[0]!;
      await dbOf(app)
        .db.update(sessions)
        .set({ rotatedAt: sql`now() - interval '1 minute'` })
        .where(eq(sessions.id, sessionId));

      const replay = await refreshWith(refreshToken).expect(401);
      expect(apiErrorSchema.parse(replay.body).code).toBe('SESSION_EXPIRED');
      expect(setCookieLine(replay, AUTH_COOKIES.refresh)).toMatch(/Expires=Thu, 01 Jan 1970/);
      // Le token légitime le plus récent ne marche plus non plus : la session est révoquée.
      await refreshWith(rotated).expect(401);
    });

    it('un secret inconnu donne 401 sans révoquer la session (connaître un id ne suffit pas à déconnecter)', async () => {
      const { refreshToken } = await loginFresh();
      const sessionId = refreshToken.split('.')[0]!;
      await refreshWith(`${sessionId}.${'x'.repeat(43)}`).expect(401);
      await refreshWith(refreshToken).expect(200);
    });

    it('401 (et non 500) pour un identifiant de session qui n’est pas un UUID', async () => {
      await refreshWith(`${'-'.repeat(36)}.${'x'.repeat(43)}`).expect(401);
    });

    it('plafonne la durée de vie d’une session à 90 jours', async () => {
      const { refreshToken } = await loginFresh();
      const sessionId = refreshToken.split('.')[0]!;
      await dbOf(app)
        .db.update(sessions)
        .set({ createdAt: sql`now() - interval '89 days'` })
        .where(eq(sessions.id, sessionId));
      await refreshWith(refreshToken).expect(200);

      const [row] = await dbOf(app).db.select().from(sessions).where(eq(sessions.id, sessionId));
      const lifetimeDays = (row!.expiresAt.getTime() - row!.createdAt.getTime()) / 86_400_000;
      expect(lifetimeDays).toBeCloseTo(90, 3);
    });

    it('401 sans cookie, avec un token mal formé ou une session expirée', async () => {
      await http().post('/v1/auth/refresh').expect(401);
      await refreshWith('nimporte-quoi').expect(401);
      const { refreshToken } = await loginFresh();
      await dbOf(app)
        .db.update(sessions)
        .set({
          expiresAt: sql`now() - interval '1 second'`,
          createdAt: sql`now() - interval '1 day'`,
        })
        .where(eq(sessions.id, refreshToken.split('.')[0]!));
      await refreshWith(refreshToken).expect(401);
    });

    it('relit le rôle en base : un changement de rôle s’applique au refresh suivant', async () => {
      const { user, refreshToken } = await loginFresh();
      await dbOf(app).db.update(users).set({ role: 'admin' }).where(eq(users.id, user.id));
      const res = await refreshWith(refreshToken).expect(200);
      expect(authResponseSchema.parse(res.body).user.role).toBe('admin');
      const accessToken = cookieValue(res, AUTH_COOKIES.access)!;
      await http()
        .get('/v1/users')
        .set('Cookie', `${AUTH_COOKIES.access}=${accessToken}`)
        .expect(200);
    });

    it('401 quand l’utilisateur a été supprimé (ses sessions partent en cascade)', async () => {
      const { user, refreshToken } = await loginFresh();
      await dbOf(app).db.delete(users).where(eq(users.id, user.id));
      await refreshWith(refreshToken).expect(401);
    });

    it('deux refresh simultanés du même token : les deux réussissent, la session reste valide', async () => {
      const { refreshToken } = await loginFresh();
      const results = await Promise.all([refreshWith(refreshToken), refreshWith(refreshToken)]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      const newTokens = results.map((r) => cookieValue(r, AUTH_COOKIES.refresh)).filter(Boolean);
      expect(newTokens).toHaveLength(1);
      await refreshWith(newTokens[0]!).expect(200);
    });
  });

  describe('POST /v1/auth/logout', () => {
    it('révoque la session et efface les cookies', async () => {
      const { user } = await registerAs(app);
      const agent = request.agent(app.getHttpServer());
      const login = await agent
        .post('/v1/auth/login')
        .send({ email: user.email, password: TEST_PASSWORD });
      const refreshToken = cookieValue(login, AUTH_COOKIES.refresh)!;

      await agent.post('/v1/auth/logout').expect(204);
      await agent.get('/v1/users/me').expect(401);
      await http()
        .post('/v1/auth/refresh')
        .set('Cookie', `${AUTH_COOKIES.refresh}=${refreshToken}`)
        .expect(401);
    });

    it('fonctionne avec un access token expiré : seul le refresh token est nécessaire', async () => {
      const { user } = await registerAs(app);
      const login = await http()
        .post('/v1/auth/login')
        .send({ email: user.email, password: TEST_PASSWORD });
      const refreshToken = cookieValue(login, AUTH_COOKIES.refresh)!;

      const res = await http()
        .post('/v1/auth/logout')
        .set('Cookie', `${AUTH_COOKIES.refresh}=${refreshToken}`)
        .expect(204);
      expect(setCookieLine(res, AUTH_COOKIES.refresh)).toMatch(/Expires=Thu, 01 Jan 1970/);
      await http()
        .post('/v1/auth/refresh')
        .set('Cookie', `${AUTH_COOKIES.refresh}=${refreshToken}`)
        .expect(401);
    });

    it('204 et cookies effacés même sans session ; un secret faux ne révoque rien', async () => {
      const anonymous = await http().post('/v1/auth/logout').expect(204);
      expect(setCookieLine(anonymous, AUTH_COOKIES.access)).toMatch(/Expires=Thu, 01 Jan 1970/);

      const { agent } = await registerAs(app);
      const sessionId = sessionListSchema.parse((await agent.get('/v1/auth/sessions')).body)
        .items[0]!.id;
      await http()
        .post('/v1/auth/logout')
        .set('Cookie', `${AUTH_COOKIES.refresh}=${sessionId}.${'x'.repeat(43)}`)
        .expect(204);
      await agent.post('/v1/auth/refresh').expect(200);
    });
  });

  describe('sessions', () => {
    it('liste les sessions actives et marque la session courante', async () => {
      const { agent, user } = await registerAs(app);
      await http()
        .post('/v1/auth/login')
        .set('User-Agent', 'Mozilla/5.0 (iPhone) Creno-Test')
        .send({ email: user.email, password: TEST_PASSWORD });

      const res = await agent.get('/v1/auth/sessions').expect(200);
      const { items } = sessionListSchema.parse(res.body);
      expect(items).toHaveLength(2);
      expect(items.filter((s) => s.current)).toHaveLength(1);
      expect(items.map((s) => s.userAgent)).toContain('Mozilla/5.0 (iPhone) Creno-Test');
    });

    it('révoque une autre de ses sessions', async () => {
      const { agent, user } = await registerAs(app);
      const other = await http()
        .post('/v1/auth/login')
        .send({ email: user.email, password: TEST_PASSWORD });
      const otherId = cookieValue(other, AUTH_COOKIES.refresh)!.split('.')[0]!;

      await agent.delete(`/v1/auth/sessions/${otherId}`).expect(204);
      const { items } = sessionListSchema.parse((await agent.get('/v1/auth/sessions')).body);
      expect(items.map((s) => s.id)).not.toContain(otherId);
    });

    it('IDOR : révoquer la session d’un autre utilisateur → 403 FORBIDDEN_OWNERSHIP', async () => {
      const alice = await registerAs(app);
      const bob = await registerAs(app);
      const bobSessions = sessionListSchema.parse((await bob.agent.get('/v1/auth/sessions')).body);

      const res = await alice.agent
        .delete(`/v1/auth/sessions/${bobSessions.items[0]!.id}`)
        .expect(403);
      expect(apiErrorSchema.parse(res.body).code).toBe('FORBIDDEN_OWNERSHIP');
      await bob.agent.get('/v1/users/me').expect(200);
    });

    it('404 pour une session inconnue, 400 pour un id invalide', async () => {
      const { agent } = await registerAs(app);
      await agent.delete('/v1/auth/sessions/00000000-0000-4000-8000-000000000000').expect(404);
      await agent.delete('/v1/auth/sessions/pas-un-uuid').expect(400);
    });
  });

  describe('protection CSRF par l’en-tête Origin', () => {
    it('refuse une requête qui modifie depuis une autre origine', async () => {
      const { user } = await registerAs(app);
      const res = await http()
        .post('/v1/auth/login')
        .set('Origin', 'https://evil.example')
        .send({ email: user.email, password: TEST_PASSWORD })
        .expect(403);
      expect(apiErrorSchema.parse(res.body).code).toBe('FORBIDDEN');
    });

    it('accepte l’origine du front', async () => {
      const { user } = await registerAs(app);
      await http()
        .post('/v1/auth/login')
        .set('Origin', WEB_ORIGIN)
        .send({ email: user.email, password: TEST_PASSWORD })
        .expect(200);
    });
  });

  it('pose les en-têtes de sécurité Helmet', async () => {
    const res = await http().get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
  });
});

describe('auth : rate limit', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp({ authRateLimit: 10 });
  });
  afterAll(async () => {
    await app.close();
  });

  it('11e tentative de login en une minute → 429 TOO_MANY_REQUESTS', async () => {
    const attempt = () =>
      request(app.getHttpServer())
        .post('/v1/auth/login')
        .send({ email: uniqueEmail(), password: 'x' });
    for (let i = 0; i < 10; i++) await attempt().expect(401);
    const res = await attempt().expect(429);
    expect(apiErrorSchema.parse(res.body).code).toBe('TOO_MANY_REQUESTS');
  });
});

describe('auth : refresh pendant une panne de la base', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp({ databaseUrl: 'postgres://creno:creno@127.0.0.1:1/creno' });
  });
  afterAll(async () => {
    await app.close();
  });

  it('répond 500 sans effacer les cookies : la session est peut-être encore valide', async () => {
    const token = `00000000-0000-4000-8000-000000000000.${'a'.repeat(43)}`;
    const res = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .set('Cookie', `${AUTH_COOKIES.refresh}=${token}`)
      .expect(500);
    expect(apiErrorSchema.parse(res.body).code).toBe('INTERNAL_ERROR');
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});
