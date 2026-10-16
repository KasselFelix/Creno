import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiErrorSchema, CLIENT_IP_HEADERS } from '@creno/shared';
import {
  createProviderWithResource,
  createTestApp,
  fakeSmsGateway,
  registerAs,
  resetDatabase,
} from './app.js';

// Secret tiré au hasard à chaque exécution : aucun secret en dur dans le dépôt.
const SECRET = randomBytes(24).toString('hex');
const PHONE = '+33612345678';
const OTHER_PHONE = '+33698765432';

/** Une lecture publique (throttler `public`) : 404 tant que la limite n'est pas atteinte, puis 429. */
function publicRead(app: INestApplication, headers: Record<string, string> = {}) {
  return request(app.getHttpServer()).get('/v1/providers/inconnu').set(headers);
}

const from = (ip: string, secret = SECRET) => ({
  [CLIENT_IP_HEADERS.ip]: ip,
  [CLIENT_IP_HEADERS.secret]: secret,
});

describe('IP du visiteur transmise par le front', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createTestApp({ clientIpSecret: SECRET, publicRateLimit: 2 });
  });
  afterEach(async () => {
    await app.close();
  });

  it('avec le bon secret, chaque IP transmise a son propre compteur', async () => {
    await publicRead(app, from('203.0.113.10')).expect(404);
    await publicRead(app, from('203.0.113.10')).expect(404);
    const limited = await publicRead(app, from('203.0.113.10')).expect(429);
    expect(apiErrorSchema.parse(limited.body).code).toBe('TOO_MANY_REQUESTS');
    // Un autre visiteur, relayé par le même serveur Next, n'est pas bloqué.
    await publicRead(app, from('2001:db8::1')).expect(404);
  });

  it('avec un secret faux, une IP invalide ou sans en-tête : adresse de la connexion', async () => {
    const forged = randomBytes(24).toString('hex');
    await publicRead(app, from('203.0.113.20', forged)).expect(404);
    await publicRead(app, from('pas-une-ip')).expect(404);
    // Même compteur (celui de la connexion) : les en-têtes ci-dessus ont été ignorés.
    await publicRead(app).expect(429);
  });
});

describe('compteurs par compte ou par IP', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp({ publicRateLimit: 2, phoneRateLimit: 2, sms: fakeSmsGateway() });
  });
  beforeEach(async () => {
    await resetDatabase(app);
  });
  afterAll(async () => {
    await app.close();
  });

  it('`public` : deux prestataires connectés derrière la même IP ont chacun leur compteur', async () => {
    const first = await createProviderWithResource(app);
    const second = await createProviderWithResource(app);
    await first.agent.get('/v1/providers/me/bookings').expect(200);
    await first.agent.get('/v1/providers/me/bookings').expect(200);
    await first.agent.get('/v1/providers/me/bookings').expect(429);
    await second.agent.get('/v1/providers/me/bookings').expect(200);
  });

  it('`phone` reste par IP : un second compte ne rouvre pas le quota de SMS', async () => {
    const first = await registerAs(app);
    const second = await registerAs(app);
    await first.agent.post('/v1/users/me/phone').send({ phone: PHONE }).expect(202);
    await first.agent.post('/v1/users/me/phone').send({ phone: OTHER_PHONE }).expect(202);
    await second.agent.post('/v1/users/me/phone').send({ phone: PHONE }).expect(429);
  });

  it('Cache-Control: no-store sur les données du dashboard', async () => {
    const { agent } = await createProviderWithResource(app);
    const res = await agent.get('/v1/providers/me/bookings').expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
