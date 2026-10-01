import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
    await request(app.getHttpServer())
      .get('/v1/search/providers?lat=48.123&lng=2.456&radiusKm=7&category=room')
      .expect(200);
    await request(app.getHttpServer())
      .get('/v1/geocoding/search?q=10%20rue%20de%20la%20Paix')
      .expect(503);

    const lines = logs.map((line) => JSON.parse(line) as LogLine);
    expect(lines.find((l) => l.event === 'search.performed')).toMatchObject({
      level: 30,
      hasCenter: true,
      radiusKm: 7,
      category: 'room',
      total: 0,
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
