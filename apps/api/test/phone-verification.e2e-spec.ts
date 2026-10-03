import type { INestApplication } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { phoneVerifications, users } from '@creno/db';
import {
  apiErrorSchema,
  PHONE_CODE_MAX_ATTEMPTS,
  PHONE_CODES_PER_ACCOUNT_PER_HOUR,
  PHONE_CODES_PER_NUMBER_PER_DAY,
  phoneCodeRequestedSchema,
  publicUserSchema,
} from '@creno/shared';
import { DeliveryError } from '../src/notifications/delivery.js';
import {
  PHONE_CODE_DEAD_QUEUE,
  PHONE_CODE_QUEUE,
  PHONE_CODE_RETRY_LIMIT,
} from '../src/users/phone-code.queues.js';
import {
  createTestApp,
  dbOf,
  fakeSmsGateway,
  phoneCodeOf,
  registerAs,
  resetDatabase,
  runJobs,
  setVerifiedPhone,
} from './app.js';

// Plage réservée à la fiction par l'ARCEP : ces numéros n'appartiennent à personne.
const PHONE = '+33639980001';
const OTHER_PHONE = '+33639980002';

type Agent = ReturnType<typeof request.agent>;

describe('vérification du téléphone', () => {
  let app: INestApplication;
  const sms = fakeSmsGateway();
  const logs: string[] = [];
  const db = () => dbOf(app).db;

  beforeAll(async () => {
    app = await createTestApp({ sms, logs });
  });
  beforeEach(async () => {
    await resetDatabase(app);
    sms.send.mockReset();
    sms.send.mockImplementation(fakeSmsGateway().send.getMockImplementation()!);
    logs.length = 0;
  });
  afterAll(async () => {
    await app.close();
  });

  const requestCode = (agent: Agent, phone = PHONE) =>
    agent.post('/v1/users/me/phone').send({ phone });
  const verify = (agent: Agent, code: string) =>
    agent.post('/v1/users/me/phone/verify').send({ code });
  const sentSms = () => sms.send.mock.calls.map(([message]) => message);
  const lastCode = () => phoneCodeOf(sentSms().at(-1)!);
  /** Un code faux à coup sûr : le vrai, décalé d'un chiffre. */
  const wrongCode = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');
  const phoneOf = async (userId: string) => {
    const [row] = await db()
      .select({ phone: users.phone, verifiedAt: users.phoneVerifiedAt })
      .from(users)
      .where(eq(users.id, userId));
    return row;
  };
  const requestsOf = (userId: string) =>
    db()
      .select()
      .from(phoneVerifications)
      .where(eq(phoneVerifications.userId, userId))
      .orderBy(asc(phoneVerifications.createdAt));
  const logged = (event: string) =>
    logs
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((l) => l.event === event);

  /** Demande un code, exécute le job d'envoi et renvoie le code reçu par SMS. */
  async function codeFor(agent: Agent, phone = PHONE): Promise<string> {
    await requestCode(agent, phone).expect(202);
    await runJobs(app, PHONE_CODE_QUEUE);
    return lastCode();
  }

  describe('demande de code', () => {
    it('202 + un seul SMS au numéro demandé ; le compte ne change pas encore', async () => {
      const { agent, user } = await registerAs(app);
      const res = await requestCode(agent).expect(202);
      const { expiresAt } = phoneCodeRequestedSchema.parse(res.body);
      expect(new Date(expiresAt).getTime() - Date.now()).toBeGreaterThan(9 * 60_000);
      expect(sms.send).not.toHaveBeenCalled();

      expect(await runJobs(app, PHONE_CODE_QUEUE)).toBe(1);
      expect(sentSms()).toHaveLength(1);
      expect(sentSms()[0]!.to).toBe(PHONE);
      expect(lastCode()).toMatch(/^\d{6}$/);
      expect(await phoneOf(user.id)).toEqual({ phone: null, verifiedAt: null });
      const [row] = await requestsOf(user.id);
      // Seul le hash du code est en base.
      expect(row!.codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row!.codeHash).not.toContain(lastCode());
    });

    it('indicatif hors liste → 400 PHONE_NOT_ALLOWED, ni ligne ni SMS', async () => {
      const { agent, user } = await registerAs(app);
      const res = await requestCode(agent, '+447900000000').expect(400);
      expect(apiErrorSchema.parse(res.body).code).toBe('PHONE_NOT_ALLOWED');
      await runJobs(app, PHONE_CODE_QUEUE);
      expect(sms.send).not.toHaveBeenCalled();
      expect(await requestsOf(user.id)).toHaveLength(0);
    });

    it('numéro mal formé → 400 ; non connecté → 401 sur les trois routes', async () => {
      const { agent } = await registerAs(app);
      await requestCode(agent, '0639980001').expect(400);
      const anonymous = request(app.getHttpServer());
      await anonymous.post('/v1/users/me/phone').send({ phone: PHONE }).expect(401);
      await anonymous.post('/v1/users/me/phone/verify').send({ code: '123456' }).expect(401);
      await anonymous.delete('/v1/users/me/phone').expect(401);
    });

    it('numéro déjà vérifié du compte → 202 sans SMS', async () => {
      const { agent, user } = await registerAs(app);
      await setVerifiedPhone(app, user.id, PHONE);
      await requestCode(agent).expect(202);
      await runJobs(app, PHONE_CODE_QUEUE);
      expect(sms.send).not.toHaveBeenCalled();
    });

    it(`${PHONE_CODES_PER_ACCOUNT_PER_HOUR + 1}ᵉ demande du compte dans l'heure → 429, aucun SMS de plus`, async () => {
      const { agent } = await registerAs(app);
      for (let i = 0; i < PHONE_CODES_PER_ACCOUNT_PER_HOUR; i += 1) {
        await requestCode(agent, i % 2 ? PHONE : OTHER_PHONE).expect(202);
      }
      const res = await requestCode(agent).expect(429);
      expect(apiErrorSchema.parse(res.body).code).toBe('TOO_MANY_REQUESTS');
      await runJobs(app, PHONE_CODE_QUEUE);
      // Seule la plus récente des demandes envoie son code (les autres sont remplacées).
      expect(sentSms()).toHaveLength(1);
      expect(logged('user.phone_code_capped')).toMatchObject([{ scope: 'account' }]);
    });

    it(`${PHONE_CODES_PER_NUMBER_PER_DAY + 1}ᵉ demande pour un numéro en 24 h, depuis plusieurs comptes → 429`, async () => {
      for (let i = 0; i < PHONE_CODES_PER_NUMBER_PER_DAY; i += 1) {
        const { agent } = await registerAs(app);
        await requestCode(agent).expect(202);
      }
      const { agent } = await registerAs(app);
      const res = await requestCode(agent).expect(429);
      // Même réponse que le plafond par compte : rien ne dit qu'un autre compte a visé ce numéro.
      expect(apiErrorSchema.parse(res.body).message).toBe(
        'Trop de codes demandés. Réessayez plus tard.',
      );
      await runJobs(app, PHONE_CODE_QUEUE);
      expect(sentSms()).toHaveLength(PHONE_CODES_PER_NUMBER_PER_DAY);
      expect(logged('user.phone_code_capped')).toMatchObject([{ scope: 'phone' }]);
    });

    it('retirer le numéro ne remet pas les plafonds à zéro', async () => {
      const { agent } = await registerAs(app);
      for (let i = 0; i < PHONE_CODES_PER_ACCOUNT_PER_HOUR; i += 1) {
        await requestCode(agent).expect(202);
        await agent.delete('/v1/users/me/phone').expect(204);
      }
      await requestCode(agent).expect(429);
    });

    it('demandes simultanées du même compte : le plafond est exact', async () => {
      const { agent } = await registerAs(app);
      const results = await Promise.all(
        Array.from({ length: PHONE_CODES_PER_ACCOUNT_PER_HOUR + 3 }, () => requestCode(agent)),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses.filter((s) => s === 202)).toHaveLength(PHONE_CODES_PER_ACCOUNT_PER_HOUR);
      expect(statuses.filter((s) => s === 429)).toHaveLength(3);
    });
  });

  describe('saisie du code', () => {
    it('bon code → 200 avec le numéro ; numéro daté ; plus aucun code accepté', async () => {
      const { agent, user } = await registerAs(app);
      const code = await codeFor(agent);
      const res = await verify(agent, code).expect(200);
      expect(publicUserSchema.parse(res.body)).toMatchObject({ id: user.id, phone: PHONE });
      expect((await phoneOf(user.id))!.verifiedAt).toBeInstanceOf(Date);
      expect((await requestsOf(user.id)).every((row) => row.codeHash === null)).toBe(true);
      expect(logged('user.phone_verified')).toMatchObject([{ userId: user.id }]);

      const replay = await verify(agent, code).expect(400);
      expect(apiErrorSchema.parse(replay.body).code).toBe('PHONE_CODE_INVALID');
    });

    it('code faux → 400 ; le bon code fonctionne encore ensuite', async () => {
      const { agent } = await registerAs(app);
      const code = await codeFor(agent);
      const res = await verify(agent, wrongCode(code)).expect(400);
      expect(apiErrorSchema.parse(res.body)).toMatchObject({
        code: 'PHONE_CODE_INVALID',
        message: 'Code incorrect ou expiré.',
      });
      await verify(agent, code).expect(200);
    });

    it(`${PHONE_CODE_MAX_ATTEMPTS} tentatives au plus, même avec le bon code ensuite`, async () => {
      const { agent, user } = await registerAs(app);
      const code = await codeFor(agent);
      for (let i = 0; i < PHONE_CODE_MAX_ATTEMPTS; i += 1) {
        await verify(agent, wrongCode(code)).expect(400);
      }
      await verify(agent, code).expect(400);
      expect((await phoneOf(user.id))!.phone).toBeNull();
    });

    it('10 tentatives parallèles : jamais plus de 5 comparaisons', async () => {
      const { agent, user } = await registerAs(app);
      const code = await codeFor(agent);
      const results = await Promise.all(
        Array.from({ length: 10 }, () => verify(agent, wrongCode(code))),
      );
      expect(results.every((r) => r.status === 400)).toBe(true);
      const [row] = await requestsOf(user.id);
      expect(row!.attempts).toBe(PHONE_CODE_MAX_ATTEMPTS);
      expect(
        logged('user.phone_code_rejected').filter((l) => l.reason === 'wrong_code'),
      ).toHaveLength(PHONE_CODE_MAX_ATTEMPTS);
    });

    it('le même bon code envoyé deux fois en parallèle : un 200 et un 400', async () => {
      const { agent } = await registerAs(app);
      const code = await codeFor(agent);
      const results = await Promise.all([verify(agent, code), verify(agent, code)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    });

    it('code expiré → 400', async () => {
      const { agent, user } = await registerAs(app);
      const code = await codeFor(agent);
      await db()
        .update(phoneVerifications)
        .set({
          createdAt: sql`now() - interval '11 minutes'`,
          expiresAt: sql`now() - interval '1 minute'`,
        })
        .where(eq(phoneVerifications.userId, user.id));
      await verify(agent, code).expect(400);
    });

    it("code d'une demande remplacée → 400 ; seul le dernier code vaut", async () => {
      const { agent } = await registerAs(app);
      const first = await codeFor(agent);
      const second = await codeFor(agent, OTHER_PHONE);
      if (first !== second) await verify(agent, first).expect(400);
      const res = await verify(agent, second).expect(200);
      expect(publicUserSchema.parse(res.body).phone).toBe(OTHER_PHONE);
    });

    it('sans demande → 400 ; code mal formé → 400 de validation', async () => {
      const { agent } = await registerAs(app);
      const res = await verify(agent, '123456').expect(400);
      expect(apiErrorSchema.parse(res.body).code).toBe('PHONE_CODE_INVALID');
      const malformed = await verify(agent, '12ab56').expect(400);
      expect(apiErrorSchema.parse(malformed.body).code).toBe('VALIDATION_FAILED');
    });

    it('changer de numéro : l’ancien reste actif tant que le nouveau n’est pas vérifié', async () => {
      const { agent, user } = await registerAs(app);
      await setVerifiedPhone(app, user.id, PHONE);
      const code = await codeFor(agent, OTHER_PHONE);
      expect((await phoneOf(user.id))!.phone).toBe(PHONE);
      await verify(agent, code).expect(200);
      expect((await phoneOf(user.id))!.phone).toBe(OTHER_PHONE);
    });
  });

  describe('un numéro vérifié n’appartient qu’à un compte', () => {
    it('demander un code pour le numéro d’un autre compte ne le lui retire pas', async () => {
      const owner = await registerAs(app);
      await setVerifiedPhone(app, owner.user.id, PHONE);
      const other = await registerAs(app);
      await requestCode(other.agent).expect(202);
      await runJobs(app, PHONE_CODE_QUEUE);
      expect((await phoneOf(owner.user.id))!.phone).toBe(PHONE);
      expect((await phoneOf(other.user.id))!.phone).toBeNull();
    });

    it('le bon code transfère le numéro : l’ancien titulaire le perd', async () => {
      const owner = await registerAs(app);
      await setVerifiedPhone(app, owner.user.id, PHONE);
      const other = await registerAs(app);
      const code = await codeFor(other.agent);
      await verify(other.agent, code).expect(200);

      expect(await phoneOf(owner.user.id)).toEqual({ phone: null, verifiedAt: null });
      expect((await phoneOf(other.user.id))!.phone).toBe(PHONE);
      expect(logged('user.phone_transferred')).toMatchObject([
        { fromUserId: owner.user.id, toUserId: other.user.id },
      ]);
    });

    it('deux comptes vérifient le même numéro en même temps : un seul titulaire', async () => {
      const a = await registerAs(app);
      const b = await registerAs(app);
      const codeA = await codeFor(a.agent);
      const codeB = await codeFor(b.agent);
      const results = await Promise.all([verify(a.agent, codeA), verify(b.agent, codeB)]);
      expect(results.every((r) => r.status === 200)).toBe(true);
      const holders = await db().select({ id: users.id }).from(users).where(eq(users.phone, PHONE));
      expect(holders).toHaveLength(1);
    });

    it('la base refuse deux comptes au même numéro, un numéro non daté ou hors E.164', async () => {
      const a = await registerAs(app);
      const b = await registerAs(app);
      await setVerifiedPhone(app, a.user.id, PHONE);
      await expect(setVerifiedPhone(app, b.user.id, PHONE)).rejects.toMatchObject({
        cause: { code: '23505' },
      });
      await expect(
        db()
          .update(users)
          .set({ phone: OTHER_PHONE, phoneVerifiedAt: null })
          .where(eq(users.id, b.user.id)),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
      await expect(setVerifiedPhone(app, b.user.id, '0639980002')).rejects.toMatchObject({
        cause: { code: '23514' },
      });
    });
  });

  describe('retrait du numéro', () => {
    it('204 ; plus de numéro ; le code en cours n’est plus accepté', async () => {
      const { agent, user } = await registerAs(app);
      await setVerifiedPhone(app, user.id, PHONE);
      const code = await codeFor(agent, OTHER_PHONE);
      await agent.delete('/v1/users/me/phone').expect(204);
      expect(await phoneOf(user.id)).toEqual({ phone: null, verifiedAt: null });
      await verify(agent, code).expect(400);
    });
  });

  describe('envoi du SMS (job)', () => {
    it('demande remplacée avant l’envoi → pas de SMS pour elle', async () => {
      const { agent } = await registerAs(app);
      await requestCode(agent).expect(202);
      await requestCode(agent, OTHER_PHONE).expect(202);
      await runJobs(app, PHONE_CODE_QUEUE);
      expect(sentSms().map((m) => m.to)).toEqual([OTHER_PHONE]);
    });

    it('délai dépassé : pas de reprise (un SMS en double serait pire), log error', async () => {
      sms.send.mockRejectedValue(new DeliveryError('timeout', true));
      const { agent } = await registerAs(app);
      await requestCode(agent).expect(202);
      await runJobs(app, PHONE_CODE_QUEUE);
      expect(await runJobs(app, PHONE_CODE_QUEUE)).toBe(0);
      expect(sms.send).toHaveBeenCalledTimes(1);
      expect(logged('user.phone_code_failed')).toMatchObject([{ reason: 'timeout' }]);
    });

    it('5xx : le job est repris avec un nouveau code, qui remplace le premier', async () => {
      sms.send.mockRejectedValueOnce(new DeliveryError('http_503', true));
      const { agent } = await registerAs(app);
      await requestCode(agent).expect(202);
      await runJobs(app, PHONE_CODE_QUEUE);
      const lost = lastCode();
      expect(logged('user.phone_code_retry')).toHaveLength(1);

      // La reprise est planifiée plus tard : on l'exécute tout de suite.
      expect(await runJobs(app, PHONE_CODE_QUEUE)).toBe(1);
      const code = lastCode();
      if (lost !== code) await verify(agent, lost).expect(400);
      await verify(agent, code).expect(200);
    });

    it(`au plus ${PHONE_CODE_RETRY_LIMIT} reprises ; la file morte le signale en error`, async () => {
      sms.send.mockRejectedValue(new DeliveryError('http_503', true));
      const { agent, user } = await registerAs(app);
      await requestCode(agent).expect(202);
      while ((await runJobs(app, PHONE_CODE_QUEUE)) > 0);
      expect(sms.send).toHaveBeenCalledTimes(PHONE_CODE_RETRY_LIMIT + 1);

      const [row] = await requestsOf(user.id);
      expect(await runJobs(app, PHONE_CODE_DEAD_QUEUE)).toBe(1);
      expect(logged('user.phone_code_failed')).toMatchObject([
        { level: 50, phoneVerificationId: row!.id, reason: 'retries_exhausted' },
      ]);
    });

    it('passerelle non configurée → warn, aucune reprise', async () => {
      sms.send.mockRejectedValue(new DeliveryError('not_configured', false));
      const { agent } = await registerAs(app);
      await requestCode(agent).expect(202);
      await runJobs(app, PHONE_CODE_QUEUE);
      expect(await runJobs(app, PHONE_CODE_QUEUE)).toBe(0);
      expect(logged('user.phone_code_skipped')).toMatchObject([{ reason: 'not_configured' }]);
    });
  });

  it('ni numéro ni code dans les logs ni dans le job', async () => {
    const { agent } = await registerAs(app);
    const code = await codeFor(agent);
    await verify(agent, wrongCode(code)).expect(400);
    await verify(agent, code).expect(200);
    const all = logs.join('\n');
    expect(all).not.toContain(PHONE);
    expect(all).not.toContain(PHONE.slice(1));
    expect(all).not.toContain(code);
    const jobs = await db().execute<{ data: unknown }>(
      sql`SELECT data FROM pgboss.job WHERE name = ${PHONE_CODE_QUEUE}`,
    );
    expect(JSON.stringify(jobs.rows)).not.toContain(PHONE);
  });
});

// Application à part : créer une seconde application remplace le logger global de Nest, ce qui
// couperait la capture des logs de la suite principale.
describe('vérification du téléphone : limite par IP', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp({ sms: fakeSmsGateway(), phoneRateLimit: 2 });
  });
  afterAll(async () => {
    await app.close();
  });

  it('demandes de code : limite horaire par IP (throttler `phone`) → 429', async () => {
    const { agent } = await registerAs(app);
    await agent.post('/v1/users/me/phone').send({ phone: PHONE }).expect(202);
    await agent.post('/v1/users/me/phone').send({ phone: OTHER_PHONE }).expect(202);
    const res = await agent.post('/v1/users/me/phone').send({ phone: PHONE }).expect(429);
    expect(apiErrorSchema.parse(res.body).code).toBe('TOO_MANY_REQUESTS');
  });
});
