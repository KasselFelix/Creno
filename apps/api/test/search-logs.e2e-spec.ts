import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEARCH_TIMEZONE } from '@creno/shared';
import { localDateOf } from '../src/availability/slots.engine.js';
import { GeocoderError } from '../src/geocoding/geocoder.js';
import { createTestApp } from './app.js';

interface LogLine {
  level: number;
  event?: string;
  reason?: string;
  req?: { url?: string };
}

// Fichier à part, comme auth-logs : le logger racine de nestjs-pino est global au processus.
describe('recherche et géocodage : logs', () => {
  let app: INestApplication;
  const logs: string[] = [];

  beforeAll(async () => {
    app = await createTestApp({
      logs,
      geocoder: { search: () => Promise.reject(new GeocoderError('timeout')) },
    });
  });
  afterAll(async () => {
    await app.close();
  });

  it('ne journalise ni la position du visiteur ni le texte recherché', async () => {
    // Le navigateur envoie l'adresse de la page `/search` dans l'en-tête Referer de chaque appel.
    const referer =
      'http://localhost:3000/search?lat=48.123&lng=2.456&place=10%20rue%20de%20la%20Paix';
    await request(app.getHttpServer())
      .get('/v1/search/providers?lat=48.123&lng=2.456&radiusKm=7&category=room')
      .set('Referer', referer)
      .expect(200);
    // Une route sans rapport avec la recherche, appelée depuis la page de recherche.
    await request(app.getHttpServer()).get('/v1/users/me').set('Referer', referer).expect(401);
    // Même route, autre casse : Express la sert, elle doit être masquée aussi.
    await request(app.getHttpServer()).get('/V1/Search/providers?lat=48.123&lng=2.456').expect(200);
    await request(app.getHttpServer())
      .get('/v1/geocoding/search?q=10%20rue%20de%20la%20Paix')
      .expect(503);

    // Avec une date : la date n'est pas une donnée personnelle, seul le fait qu'elle soit là est loggé.
    await request(app.getHttpServer())
      .get(`/v1/search/providers?date=${localDateOf(new Date(), SEARCH_TIMEZONE)}`)
      .expect(200);

    const lines = logs.map((line) => JSON.parse(line) as LogLine);
    const performed = lines.filter((l) => l.event === 'search.performed');
    expect(performed.at(-1)).toMatchObject({ level: 30, hasCenter: false, hasDate: true });
    expect(lines.find((l) => l.event === 'search.performed')).toMatchObject({
      level: 30,
      hasCenter: true,
      radiusKm: 7,
      category: 'room',
      hasDate: false,
      total: 0,
      totalIsCapped: false,
    });
    // Service tiers indisponible : un `warn` (dégradé), jamais un `error`.
    expect(lines.find((l) => l.event === 'geocoding.failed')).toMatchObject({
      level: 40,
      reason: 'timeout',
      queryLength: 17,
    });
    expect(lines.some((l) => l.level >= 50)).toBe(false);
    // Les logs d'accès gardent le chemin, pas la query string.
    expect(lines.map((l) => l.req?.url).filter(Boolean)).toEqual(
      expect.arrayContaining([
        '/v1/search/providers?[redacted]',
        '/v1/geocoding/search?[redacted]',
      ]),
    );

    const all = logs.join('\n');
    for (const secret of ['48.123', '2.456', 'rue de', 'Paix']) expect(all).not.toContain(secret);
  });
});
