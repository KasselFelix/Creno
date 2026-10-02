import type { INestApplication } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pendingRegistrations, users } from '@creno/db';
import { apiErrorSchema, authResponseSchema } from '@creno/shared';
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
  resetDatabase,
  runJobs,
  TEST_PASSWORD,
  uniqueEmail,
  verificationTokenOf,
  WEB_ORIGIN,
} from './app.js';

const OTHER_PASSWORD = 'un-autre-mot-de-passe';

describe('inscription et confirmation de l’adresse', () => {
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

  const register = (address: string, patch: Record<string, unknown> = {}) =>
    http()
      .post('/v1/auth/register')
      .send({
        email: address,
        password: TEST_PASSWORD,
        fullName: 'Léa Petit',
        role: 'customer',
        ...patch,
      });
  const verify = (token: string) => http().post('/v1/auth/email/verify').send({ token });
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
  async function registerAndGetToken(address: string, patch: Record<string, unknown> = {}) {
    await register(address, patch).expect(202);
    await runJobs(app, REGISTRATION_EMAIL_QUEUE);
    return verificationTokenOf(sentEmails().at(-1)!);
  }

  describe('POST /v1/auth/register', () => {
    it('répond 202 sans corps ni cookie, ne crée pas de compte, et envoie un lien de confirmation', async () => {
      const address = uniqueEmail();
      const res = await register(address, { role: 'provider' }).expect(202);

      expect(res.text).toBe('');
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(await accountsOf(address)).toHaveLength(0);
      const [pending] = await pendingOf(address);
      expect(pending).toMatchObject({ fullName: 'Léa Petit', role: 'provider', tokenHash: null });
      expect(pending!.passwordHash).toMatch(/^\$argon2id\$/);

      expect(await runJobs(app, REGISTRATION_EMAIL_QUEUE)).toBe(1);
      const messages = sentEmails();
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ to: address, subject: 'Confirmez votre adresse email' });
      const token = verificationTokenOf(messages[0]!);
      expect(messages[0]!.text).toContain(`${WEB_ORIGIN}/verify-email#${token}`);
      expect(messages[0]!.html).toContain(`${WEB_ORIGIN}/verify-email#${token}`);
      // Seul le hash du secret est en base.
      const [after] = await pendingOf(address);
      expect(after!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(token).not.toContain(after!.tokenHash!);
    });

    it('adresse déjà inscrite (casse différente comprise) : même réponse, email « déjà un compte » sans lien, compte inchangé', async () => {
      const { user } = await registerAs(app);
      const fresh = await register(uniqueEmail()).expect(202);
      const taken = await register(user.email.toUpperCase(), { password: OTHER_PASSWORD }).expect(
        202,
      );

      expect(taken.text).toBe(fresh.text);
      expect(taken.headers['set-cookie']).toBeUndefined();
      expect(taken.headers['content-type']).toBe(fresh.headers['content-type']);

      await runJobs(app, REGISTRATION_EMAIL_QUEUE);
      const message = sentEmails().find((m) => m.to === user.email);
      expect(message).toMatchObject({ subject: 'Vous avez déjà un compte Creno' });
      expect(message!.text).not.toContain('verify-email');
      expect(message!.text).toContain(`${WEB_ORIGIN}/login`);
      // La tentative n'est confirmable par personne, et le mot de passe du compte n'a pas changé.
      expect((await pendingOf(user.email))[0]).toMatchObject({ tokenHash: null });
      expect(await accountsOf(user.email)).toHaveLength(1);
      await login(user.email).expect(200);
      await login(user.email, OTHER_PASSWORD).expect(401);
    });

    it('l’email de confirmation ne reprend pas le nom saisi dans le formulaire', async () => {
      await register(uniqueEmail(), { fullName: 'Gagnez 1000 euros sur evil.example' }).expect(202);
      await runJobs(app, REGISTRATION_EMAIL_QUEUE);
      const [message] = sentEmails();
      expect(`${message!.subject}${message!.text}${message!.html}`).not.toContain('evil.example');
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

      // Le plafond glisse : une tentative de plus d'une heure ne compte plus.
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

    it.each([
      ['mot de passe trop court', { password: 'court' }, 'password'],
      ['email invalide', { email: 'pas-un-email' }, 'email'],
      ['rôle admin', { role: 'admin' }, 'role'],
    ])('400 VALIDATION_FAILED : %s', async (_label, patch, field) => {
      const res = await register(uniqueEmail(), patch).expect(400);
      const body = apiErrorSchema.parse(res.body);
      expect(body.code).toBe('VALIDATION_FAILED');
      expect(body.details).toMatchObject({ fieldErrors: { [field]: expect.any(Array) } });
    });
  });

  describe('POST /v1/auth/email/verify', () => {
    it('crée le compte confirmé, sans ouvrir de session ; la connexion fonctionne ensuite', async () => {
      const address = uniqueEmail();
      await login(address).expect(401); // pas de compte avant la confirmation
      const token = await registerAndGetToken(address, { role: 'provider' });
      const denied = await login(address).expect(401);
      expect(apiErrorSchema.parse(denied.body).code).toBe('INVALID_CREDENTIALS');

      const res = await verify(token).expect(204);

      expect(res.headers['set-cookie']).toBeUndefined();
      const [account] = await accountsOf(address);
      expect(account).toMatchObject({ email: address, fullName: 'Léa Petit', role: 'provider' });
      expect(Date.now() - account!.emailVerifiedAt.getTime()).toBeLessThan(60_000);
      expect(await pendingOf(address)).toHaveLength(0);
      const session = await login(address).expect(200);
      expect(authResponseSchema.parse(session.body).user).toMatchObject({
        id: account!.id,
        role: 'provider',
      });
      expect(logged('auth.registered')).toMatchObject([{ userId: account!.id, role: 'provider' }]);
    });

    it('lien rejoué, abîmé, inconnu ou au mauvais secret → 400 VERIFICATION_LINK_INVALID, aucun compte', async () => {
      const address = uniqueEmail();
      const token = await registerAndGetToken(address);
      const [id, secret] = token.split('.') as [string, string];
      const wrongSecret = `${id}.${secret.startsWith('A') ? 'B' : 'A'}${secret.slice(1)}`;
      const unknown = `00000000-0000-4000-8000-000000000000.${secret}`;

      for (const bad of [wrongSecret, unknown, 'pas-un-jeton', id]) {
        const res = await verify(bad).expect(400);
        expect(apiErrorSchema.parse(res.body).code).toBe('VERIFICATION_LINK_INVALID');
      }
      expect(await accountsOf(address)).toHaveLength(0);

      await verify(token).expect(204);
      const replay = await verify(token).expect(400);
      expect(apiErrorSchema.parse(replay.body).code).toBe('VERIFICATION_LINK_INVALID');
      expect(await accountsOf(address)).toHaveLength(1);
      expect(logged('auth.verification_rejected').map((l) => l.reason)).toEqual([
        'bad_secret',
        'unknown',
        'malformed',
        'malformed',
        'unknown',
      ]);
    });

    it('lien expiré → 400, aucun compte', async () => {
      const address = uniqueEmail();
      const token = await registerAndGetToken(address);
      await db()
        .update(pendingRegistrations)
        .set({
          createdAt: sql`now() - interval '25 hours'`,
          expiresAt: sql`now() - interval '1 hour'`,
        })
        .where(eq(pendingRegistrations.email, address));

      const res = await verify(token).expect(400);
      expect(apiErrorSchema.parse(res.body).code).toBe('VERIFICATION_LINK_INVALID');
      expect(await accountsOf(address)).toHaveLength(0);
    });

    it('sans jeton → 400 VALIDATION_FAILED', async () => {
      const res = await http().post('/v1/auth/email/verify').send({}).expect(400);
      expect(apiErrorSchema.parse(res.body).code).toBe('VALIDATION_FAILED');
    });

    it('deux inscriptions en attente pour une adresse : le lien confirmé fixe le mot de passe, l’autre lien meurt', async () => {
      const address = uniqueEmail();
      const first = await registerAndGetToken(address);
      const second = await registerAndGetToken(address, {
        password: OTHER_PASSWORD,
        fullName: 'Quelqu’un d’autre',
      });

      await verify(first).expect(204);

      await login(address, TEST_PASSWORD).expect(200);
      await login(address, OTHER_PASSWORD).expect(401);
      expect((await accountsOf(address))[0]).toMatchObject({ fullName: 'Léa Petit' });
      await verify(second).expect(400);
      expect(await accountsOf(address)).toHaveLength(1);
    });

    it('deux liens d’une même adresse confirmés en même temps : un 204, un 400, un seul compte', async () => {
      const address = uniqueEmail();
      const first = await registerAndGetToken(address);
      const second = await registerAndGetToken(address, { password: OTHER_PASSWORD });

      const statuses = (await Promise.all([verify(first), verify(second)])).map((r) => r.status);

      expect(statuses.sort()).toEqual([204, 400]);
      expect(await accountsOf(address)).toHaveLength(1);
      expect(await pendingOf(address)).toHaveLength(0);
    });

    it('le même lien dans deux onglets : un 204, un 400, un seul compte', async () => {
      const address = uniqueEmail();
      const token = await registerAndGetToken(address);

      const statuses = (await Promise.all([verify(token), verify(token)])).map((r) => r.status);

      expect(statuses.sort()).toEqual([204, 400]);
      expect(await accountsOf(address)).toHaveLength(1);
    });
  });

  describe('job d’email d’inscription', () => {
    it('adresse confirmée avant l’envoi d’une autre tentative : rien ne part', async () => {
      const address = uniqueEmail();
      const token = await registerAndGetToken(address);
      await register(address).expect(202); // seconde tentative, job en attente
      await verify(token).expect(204);
      email.send.mockClear();

      expect(await runJobs(app, REGISTRATION_EMAIL_QUEUE)).toBe(1);
      expect(email.send).not.toHaveBeenCalled();
    });

    it('panne passagère de la passerelle : le job est repris, avec un nouveau lien qui remplace le premier', async () => {
      const address = uniqueEmail();
      email.send.mockRejectedValueOnce(new DeliveryError('timeout', true));
      await register(address).expect(202);
      await runJobs(app, REGISTRATION_EMAIL_QUEUE);
      const lost = verificationTokenOf(sentEmails()[0]!);
      expect(logged('auth.registration_email_retry')).toHaveLength(1);

      // La reprise est planifiée 30 s plus tard : on l'exécute tout de suite.
      await runJobs(app, REGISTRATION_EMAIL_QUEUE);
      const token = verificationTokenOf(sentEmails()[1]!);

      expect(token).not.toBe(lost);
      expect(sentEmails()[0]!.idempotencyKey).not.toBe(sentEmails()[1]!.idempotencyKey);
      await verify(lost).expect(400);
      await verify(token).expect(204);
    });

    it('adresse refusée par le fournisseur : pas de reprise, log error', async () => {
      email.send.mockRejectedValueOnce(new DeliveryError('http_422', false));
      await register(uniqueEmail()).expect(202);
      await runJobs(app, REGISTRATION_EMAIL_QUEUE);

      expect(await runJobs(app, REGISTRATION_EMAIL_QUEUE)).toBe(0);
      expect(logged('auth.registration_email_failed')).toMatchObject([
        { level: 50, reason: 'http_422', kind: 'verification' },
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
    const token = await registerAndGetToken(address);
    await verify(`${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`).expect(400);
    await verify(token).expect(204);
    const { user } = await registerAs(app);
    await register(user.email).expect(202);
    await runJobs(app, REGISTRATION_EMAIL_QUEUE);

    const events = logs.map((line) => (JSON.parse(line) as { event?: string }).event);
    expect(events).toEqual(
      expect.arrayContaining([
        'auth.registration_requested',
        'auth.registration_email_sent',
        'auth.verification_rejected',
        'auth.registered',
      ]),
    );
    const all = logs.join('\n');
    const [, secret] = token.split('.') as [string, string];
    for (const sensitive of [address, user.email, TEST_PASSWORD, '$argon2id', secret]) {
      expect(all).not.toContain(sensitive);
    }
  });
});

describe('inscription : rate limit', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp({ authRateLimit: 5 });
  });
  afterAll(async () => {
    await app.close();
  });

  it('la confirmation partage la limite des routes d’identifiants → 429', async () => {
    const attempt = () =>
      request(app.getHttpServer()).post('/v1/auth/email/verify').send({ token: 'x' });
    for (let i = 0; i < 5; i++) await attempt().expect(400);
    const res = await attempt().expect(429);
    expect(apiErrorSchema.parse(res.body).code).toBe('TOO_MANY_REQUESTS');
  });
});
