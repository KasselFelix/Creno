import type { INestApplication } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pendingRegistrations, sessions, users } from '@creno/db';
import { AUTH_COOKIES, apiErrorSchema, authResponseSchema } from '@creno/shared';
import {
  MAX_REGISTRATION_EMAILS_PER_ADDRESS_PER_HOUR,
  REGISTRATION_EMAIL_DEAD_QUEUE,
  REGISTRATION_EMAIL_QUEUE,
} from '../src/auth/registration.queues.js';
import { JobsService } from '../src/jobs/jobs.service.js';
import { DeliveryError } from '../src/notifications/delivery.js';
import {
  createTestApp,
  dbOf,
  fakeEmailGateway,
  registerAs,
  registrationTokenOf,
  resetDatabase,
  runJobs,
  setCookieLine,
  TEST_PASSWORD,
  uniqueEmail,
  WEB_ORIGIN,
} from './app.js';

const OTHER_PASSWORD = 'un-autre-mot-de-passe';
const PROFILE = { password: TEST_PASSWORD, fullName: 'Léa Petit', role: 'customer' } as const;

describe('inscription par lien envoyé par email', () => {
  let app: INestApplication;
  const email = fakeEmailGateway();
  const logs: string[] = [];
  const http = () => request(app.getHttpServer());
  const db = () => dbOf(app).db;

  beforeAll(async () => {
    app = await createTestApp({ email, logs });
  });
  beforeEach(async () => {
    await resetDatabase(app);
    email.send.mockClear();
    logs.length = 0;
  });
  afterAll(async () => {
    await app.close();
  });

  const register = (address: string) => http().post('/v1/auth/register').send({ email: address });
  const complete = (token: string, profile: Record<string, unknown> = {}) =>
    http()
      .post('/v1/auth/register/complete')
      .send({ token, ...PROFILE, ...profile });
  const login = (address: string, password = TEST_PASSWORD) =>
    http().post('/v1/auth/login').send({ email: address, password });
  const sentEmails = () => email.send.mock.calls.map(([message]) => message);
  const pendingOf = (address: string) =>
    db().select().from(pendingRegistrations).where(eq(pendingRegistrations.email, address));
  const accountsOf = (address: string) => db().select().from(users).where(eq(users.email, address));
  const logged = (event: string) =>
    logs
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((l) => l.event === event);

  /** Demande d'inscription, envoi de l'email, et jeton du lien reçu. */
  async function requestLink(address: string) {
    await register(address).expect(202);
    await runJobs(app, REGISTRATION_EMAIL_QUEUE);
    return registrationTokenOf(sentEmails().at(-1)!);
  }

  describe('POST /v1/auth/register', () => {
    it('répond 202 sans corps ni cookie, ne crée pas de compte, et envoie un lien', async () => {
      const address = uniqueEmail();
      const res = await register(address).expect(202);

      expect(res.text).toBe('');
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(await accountsOf(address)).toHaveLength(0);
      const [pending] = await pendingOf(address);
      expect(pending).toMatchObject({ email: address, tokenHash: null });

      expect(await runJobs(app, REGISTRATION_EMAIL_QUEUE)).toBe(1);
      const messages = sentEmails();
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        to: address,
        subject: 'Terminez votre inscription sur Creno',
      });
      const token = registrationTokenOf(messages[0]!);
      expect(messages[0]!.text).toContain(`${WEB_ORIGIN}/register/complete#${token}`);
      expect(messages[0]!.html).toContain(`${WEB_ORIGIN}/register/complete#${token}`);
      // Seul le hash du secret est en base.
      const [after] = await pendingOf(address);
      expect(after!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(token).not.toContain(after!.tokenHash!);
    });

    it('adresse déjà inscrite (casse différente comprise) : même réponse, email « déjà un compte » sans lien', async () => {
      const { user } = await registerAs(app);
      const fresh = await register(uniqueEmail()).expect(202);
      const taken = await register(user.email.toUpperCase()).expect(202);

      expect(taken.text).toBe(fresh.text);
      expect(taken.headers['set-cookie']).toBeUndefined();
      expect(taken.headers['content-type']).toBe(fresh.headers['content-type']);

      await runJobs(app, REGISTRATION_EMAIL_QUEUE);
      const message = sentEmails().find((m) => m.to === user.email);
      expect(message).toMatchObject({ subject: 'Vous avez déjà un compte Creno' });
      expect(message!.text).not.toContain('/register/complete');
      expect(message!.text).toContain(`${WEB_ORIGIN}/login`);
      // La demande n'est utilisable par personne, et le compte n'a pas changé.
      expect((await pendingOf(user.email))[0]).toMatchObject({ tokenHash: null });
      await login(user.email).expect(200);
    });

    it(`au-delà de ${MAX_REGISTRATION_EMAILS_PER_ADDRESS_PER_HOUR} demandes par heure pour une adresse : 202, mais ni ligne ni email de plus`, async () => {
      const address = uniqueEmail();
      for (let i = 0; i < MAX_REGISTRATION_EMAILS_PER_ADDRESS_PER_HOUR; i++) {
        await register(address).expect(202);
      }
      const capped = await register(address.toUpperCase()).expect(202);

      expect(capped.text).toBe('');
      expect(await pendingOf(address)).toHaveLength(MAX_REGISTRATION_EMAILS_PER_ADDRESS_PER_HOUR);
      expect(await runJobs(app, REGISTRATION_EMAIL_QUEUE)).toBe(
        MAX_REGISTRATION_EMAILS_PER_ADDRESS_PER_HOUR,
      );
      expect(logged('auth.registration_capped')).toHaveLength(1);

      // Le plafond glisse : une demande de plus d'une heure ne compte plus.
      await db()
        .update(pendingRegistrations)
        .set({ createdAt: sql`now() - interval '61 minutes'` })
        .where(eq(pendingRegistrations.email, address));
      await register(address).expect(202);
      expect(await runJobs(app, REGISTRATION_EMAIL_QUEUE)).toBe(1);
    });

    it('demandes simultanées pour une même adresse : le plafond tient', async () => {
      const address = uniqueEmail();
      await Promise.all(Array.from({ length: 6 }, () => register(address).expect(202)));
      expect(await pendingOf(address)).toHaveLength(MAX_REGISTRATION_EMAILS_PER_ADDRESS_PER_HOUR);
    });

    it('400 VALIDATION_FAILED : email invalide', async () => {
      const res = await register('pas-un-email').expect(400);
      const body = apiErrorSchema.parse(res.body);
      expect(body.code).toBe('VALIDATION_FAILED');
      expect(body.details).toMatchObject({ fieldErrors: { email: expect.any(Array) } });
    });
  });

  describe('POST /v1/auth/register/complete', () => {
    it('crée le compte avec le profil saisi depuis le lien et ouvre une session', async () => {
      const address = uniqueEmail();
      const token = await requestLink(address);
      const before = await login(address).expect(401); // pas de compte avant la fin de l'inscription
      expect(apiErrorSchema.parse(before.body).code).toBe('INVALID_CREDENTIALS');

      const agent = request.agent(app.getHttpServer());
      const res = await agent
        .post('/v1/auth/register/complete')
        .send({ token, ...PROFILE, role: 'provider' })
        .expect(200);

      const { user } = authResponseSchema.parse(res.body);
      expect(user).toMatchObject({ email: address, fullName: 'Léa Petit', role: 'provider' });
      expect(JSON.stringify(res.body)).not.toMatch(/hash|password|token/i);
      expect(setCookieLine(res, AUTH_COOKIES.access)).toMatch(/HttpOnly/i);
      expect(setCookieLine(res, AUTH_COOKIES.refresh)).toMatch(/SameSite=Strict/i);
      await agent.get('/v1/users/me').expect(200);

      const [account] = await accountsOf(address);
      expect(account!.passwordHash).toMatch(/^\$argon2id\$/);
      expect(Date.now() - account!.emailVerifiedAt.getTime()).toBeLessThan(60_000);
      expect(await pendingOf(address)).toHaveLength(0);
      await login(address).expect(200);
      expect(logged('auth.registered')).toMatchObject([{ userId: user.id, role: 'provider' }]);
    });

    it('un autre compte était connecté dans ce navigateur : sa session est fermée', async () => {
      const previous = await registerAs(app);
      const token = await requestLink(uniqueEmail());

      await previous.agent
        .post('/v1/auth/register/complete')
        .send({ token, ...PROFILE })
        .expect(200);

      // L'agent porte maintenant les cookies du nouveau compte ; l'ancienne session est révoquée.
      const me = await previous.agent.get('/v1/users/me').expect(200);
      expect(me.body).not.toMatchObject({ id: previous.user.id });
      const rows = await db()
        .select({ revokedAt: sessions.revokedAt })
        .from(sessions)
        .where(eq(sessions.userId, previous.user.id));
      expect(rows).toEqual([{ revokedAt: expect.any(Date) }]);
    });

    it('lien rejoué, abîmé, inconnu ou au mauvais secret → 400 REGISTRATION_LINK_INVALID, aucun compte', async () => {
      const address = uniqueEmail();
      const token = await requestLink(address);
      const [id, secret] = token.split('.') as [string, string];
      const wrongSecret = `${id}.${secret.startsWith('A') ? 'B' : 'A'}${secret.slice(1)}`;
      const unknown = `00000000-0000-4000-8000-000000000000.${secret}`;

      for (const bad of [wrongSecret, unknown, 'pas-un-jeton', id]) {
        const res = await complete(bad).expect(400);
        expect(apiErrorSchema.parse(res.body).code).toBe('REGISTRATION_LINK_INVALID');
        expect(res.headers['set-cookie']).toBeUndefined();
      }
      expect(await accountsOf(address)).toHaveLength(0);

      await complete(token).expect(200);
      const replay = await complete(token, { password: OTHER_PASSWORD }).expect(400);
      expect(apiErrorSchema.parse(replay.body).code).toBe('REGISTRATION_LINK_INVALID');
      expect(await accountsOf(address)).toHaveLength(1);
      await login(address, OTHER_PASSWORD).expect(401);
      expect(logged('auth.registration_link_rejected').map((l) => l.reason)).toEqual([
        'bad_secret',
        'unknown',
        'malformed',
        'malformed',
        'unknown',
      ]);
    });

    it('lien expiré → 400, aucun compte', async () => {
      const address = uniqueEmail();
      const token = await requestLink(address);
      await db()
        .update(pendingRegistrations)
        .set({
          createdAt: sql`now() - interval '25 hours'`,
          expiresAt: sql`now() - interval '1 hour'`,
        })
        .where(eq(pendingRegistrations.email, address));

      const res = await complete(token).expect(400);
      expect(apiErrorSchema.parse(res.body).code).toBe('REGISTRATION_LINK_INVALID');
      expect(await accountsOf(address)).toHaveLength(0);
    });

    it.each([
      ['mot de passe trop court', { password: 'court' }, 'password'],
      ['rôle admin', { role: 'admin' }, 'role'],
      ['nom vide', { fullName: ' ' }, 'fullName'],
      ['sans jeton', { token: '' }, 'token'],
    ])('400 VALIDATION_FAILED : %s, et le lien reste utilisable', async (_label, patch, field) => {
      const address = uniqueEmail();
      const token = await requestLink(address);
      const res = await complete(token, patch).expect(400);
      const body = apiErrorSchema.parse(res.body);
      expect(body.code).toBe('VALIDATION_FAILED');
      expect(body.details).toMatchObject({ fieldErrors: { [field]: expect.any(Array) } });
      await complete(token).expect(200);
    });

    it('plafond saturé par un tiers : le titulaire de la boîte termine quand même, avec son propre mot de passe', async () => {
      const address = uniqueEmail();
      // Le tiers épuise le plafond de l'adresse ; la demande du titulaire ne crée alors rien.
      for (let i = 0; i < MAX_REGISTRATION_EMAILS_PER_ADDRESS_PER_HOUR; i++) {
        await register(address).expect(202);
      }
      await register(address).expect(202);
      await runJobs(app, REGISTRATION_EMAIL_QUEUE);

      // N'importe lequel des liens reçus convient : aucun ne porte de mot de passe ni de profil.
      const [first, second] = sentEmails().map(registrationTokenOf);
      await complete(second!, { password: OTHER_PASSWORD }).expect(200);

      await login(address, OTHER_PASSWORD).expect(200);
      await login(address, TEST_PASSWORD).expect(401);
      await complete(first!).expect(400);
      expect(await accountsOf(address)).toHaveLength(1);
    });

    it('deux liens d’une même adresse utilisés en même temps : un 200, un 400, un seul compte', async () => {
      const address = uniqueEmail();
      const first = await requestLink(address);
      const second = await requestLink(address);

      const statuses = (
        await Promise.all([complete(first), complete(second, { password: OTHER_PASSWORD })])
      ).map((r) => r.status);

      expect(statuses.sort()).toEqual([200, 400]);
      expect(await accountsOf(address)).toHaveLength(1);
      expect(await pendingOf(address)).toHaveLength(0);
    });

    it('le même lien dans deux onglets : un 200, un 400, un seul compte', async () => {
      const address = uniqueEmail();
      const token = await requestLink(address);

      const statuses = (await Promise.all([complete(token), complete(token)])).map((r) => r.status);

      expect(statuses.sort()).toEqual([200, 400]);
      expect(await accountsOf(address)).toHaveLength(1);
    });
  });

  describe('job d’email d’inscription', () => {
    it('compte créé avant l’envoi d’une autre demande : rien ne part', async () => {
      const address = uniqueEmail();
      const token = await requestLink(address);
      await register(address).expect(202); // seconde demande, job en attente
      await complete(token).expect(200);
      email.send.mockClear();

      expect(await runJobs(app, REGISTRATION_EMAIL_QUEUE)).toBe(1);
      expect(email.send).not.toHaveBeenCalled();
    });

    it('panne passagère de la passerelle : le job est repris, avec un nouveau lien qui remplace le premier', async () => {
      const address = uniqueEmail();
      email.send.mockRejectedValueOnce(new DeliveryError('timeout', true));
      await register(address).expect(202);
      await runJobs(app, REGISTRATION_EMAIL_QUEUE);
      const lost = registrationTokenOf(sentEmails()[0]!);
      expect(logged('auth.registration_email_retry')).toHaveLength(1);

      // La reprise est planifiée 30 s plus tard : on l'exécute tout de suite.
      await runJobs(app, REGISTRATION_EMAIL_QUEUE);
      const token = registrationTokenOf(sentEmails()[1]!);

      expect(token).not.toBe(lost);
      expect(sentEmails()[0]!.idempotencyKey).not.toBe(sentEmails()[1]!.idempotencyKey);
      await complete(lost).expect(400);
      await complete(token).expect(200);
    });

    it('adresse refusée par le fournisseur : pas de reprise, log error', async () => {
      email.send.mockRejectedValueOnce(new DeliveryError('http_422', false));
      await register(uniqueEmail()).expect(202);
      await runJobs(app, REGISTRATION_EMAIL_QUEUE);

      expect(await runJobs(app, REGISTRATION_EMAIL_QUEUE)).toBe(0);
      expect(logged('auth.registration_email_failed')).toMatchObject([
        { level: 50, reason: 'http_422', kind: 'registration_link' },
      ]);
    });

    it('passerelle non configurée : pas de reprise, log warn', async () => {
      email.send.mockRejectedValueOnce(new DeliveryError('not_configured', false));
      await register(uniqueEmail()).expect(202);
      await runJobs(app, REGISTRATION_EMAIL_QUEUE);

      expect(await runJobs(app, REGISTRATION_EMAIL_QUEUE)).toBe(0);
      expect(logged('auth.registration_email_skipped')).toMatchObject([
        { level: 40, reason: 'not_configured' },
      ]);
    });

    it('reprises épuisées : la file morte le signale en error', async () => {
      const id = '00000000-0000-4000-8000-000000000000';
      await app.get(JobsService).send(REGISTRATION_EMAIL_DEAD_QUEUE, { pendingRegistrationId: id });
      await runJobs(app, REGISTRATION_EMAIL_DEAD_QUEUE);
      expect(logged('auth.registration_email_failed')).toMatchObject([
        { level: 50, pendingRegistrationId: id, reason: 'retries_exhausted' },
      ]);
    });
  });

  it('ne journalise ni adresse, ni mot de passe, ni hash, ni jeton', async () => {
    const address = uniqueEmail();
    const token = await requestLink(address);
    await complete(`${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`).expect(400);
    await complete(token).expect(200);
    const { user } = await registerAs(app);
    await register(user.email).expect(202);
    await runJobs(app, REGISTRATION_EMAIL_QUEUE);

    const events = logs.map((line) => (JSON.parse(line) as { event?: string }).event);
    expect(events).toEqual(
      expect.arrayContaining([
        'auth.registration_requested',
        'auth.registration_email_sent',
        'auth.registration_link_rejected',
        'auth.registered',
      ]),
    );
    const all = logs.join('\n');
    const [, secret] = token.split('.') as [string, string];
    for (const sensitive of [address, user.email, TEST_PASSWORD, '$argon2id', secret]) {
      expect(all).not.toContain(sensitive);
    }
    expect(all).not.toMatch(/creno_(at|rt)=/);
  });
});

describe('inscription : limites par IP', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp({ authRateLimit: 5, registrationRateLimit: 3 });
  });
  afterAll(async () => {
    await app.close();
  });

  it('demandes d’inscription : limite horaire par IP, même sur des adresses toutes différentes → 429', async () => {
    const attempt = () =>
      request(app.getHttpServer()).post('/v1/auth/register').send({ email: uniqueEmail() });
    for (let i = 0; i < 3; i++) await attempt().expect(202);
    const res = await attempt().expect(429);
    expect(apiErrorSchema.parse(res.body).code).toBe('TOO_MANY_REQUESTS');
  });

  it('fin d’inscription : limitée à la minute par IP, comme les autres routes d’identifiants → 429', async () => {
    const attempt = () =>
      request(app.getHttpServer())
        .post('/v1/auth/register/complete')
        .send({ token: 'x', ...PROFILE });
    for (let i = 0; i < 5; i++) await attempt().expect(400);
    const res = await attempt().expect(429);
    expect(apiErrorSchema.parse(res.body).code).toBe('TOO_MANY_REQUESTS');
  });
});
