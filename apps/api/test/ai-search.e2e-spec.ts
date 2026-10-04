import type { INestApplication } from '@nestjs/common';
import { desc } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiRequests } from '@creno/db';
import {
  type AiSearchExtraction,
  type GeocodingResult,
  type InterpretResponse,
  interpretResponseSchema,
  SEARCH_TIMEZONE,
} from '@creno/shared';
import {
  type ExtractionResult,
  type FilterExtractor,
  FilterExtractorError,
} from '../src/ai-search/filter-extractor.js';
import { addLocalDays, localDateOf } from '../src/availability/slots.engine.js';
import { type Geocoder, GeocoderError } from '../src/geocoding/geocoder.js';
import { createTestApp, dbOf, resetDatabase } from './app.js';

const MODEL = 'mistral-small-2603';
const LYON: GeocodingResult = {
  label: 'Lyon',
  name: 'Lyon',
  city: 'Lyon',
  postcode: '69001',
  latitude: 45.757814,
  longitude: 4.832011,
  kind: 'city',
};

const EMPTY: AiSearchExtraction = {
  category: null,
  place: null,
  nearMe: false,
  radiusKm: null,
  priceMaxEuros: null,
  date: null,
  ignored: [],
};

/** Réponse du faux modèle : sortie donnée, 500 tokens en entrée et 80 en sortie. */
const answer = (output: unknown): ExtractionResult => ({
  output,
  model: MODEL,
  usage: { inputTokens: 500, outputTokens: 80 },
});

/** Faux modèle dont le comportement change à chaque test. */
const extractor = {
  configured: true,
  extract: vi.fn<FilterExtractor['extract']>(),
} satisfies FilterExtractor;

/** Faux géocodeur : connaît Lyon, rien d'autre (sauf réglage dans un test). */
const geocoder = { search: vi.fn<Geocoder['search']>() } satisfies Geocoder;

const lastRow = async (app: INestApplication) =>
  (await dbOf(app).db.select().from(aiRequests).orderBy(desc(aiRequests.createdAt)).limit(1))[0];

async function interpret(app: INestApplication, query: string) {
  const res = await request(app.getHttpServer())
    .post('/v1/search/interpret')
    .send({ query })
    .expect(200);
  return { body: interpretResponseSchema.parse(res.body) as InterpretResponse, res };
}

describe('POST /v1/search/interpret (modèle configuré)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp({ filterExtractor: extractor, geocoder });
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDatabase(app);
    extractor.extract.mockReset();
    geocoder.search.mockReset();
    geocoder.search.mockImplementation((query) => Promise.resolve(query === 'Lyon' ? [LYON] : []));
  });

  it('traduit la phrase en filtres et journalise tokens et coût, sans la phrase', async () => {
    const query = 'coiffeur à Lyon moins de 30 €';
    extractor.extract.mockResolvedValue(
      answer({ ...EMPTY, category: 'hairdresser', place: 'Lyon', priceMaxEuros: 30 }),
    );

    const { body, res } = await interpret(app, query);

    expect(body).toEqual({
      source: 'ai',
      filters: {
        category: 'hairdresser',
        place: { label: 'Lyon', lat: 45.758, lng: 4.832 },
        priceMax: 3000,
      },
      notices: [],
    });
    expect(extractor.extract).toHaveBeenCalledWith(
      { query, today: localDateOf(new Date(), SEARCH_TIMEZONE) },
      expect.any(AbortSignal),
    );
    expect(geocoder.search).toHaveBeenCalledWith('Lyon', 1);
    expect(await lastRow(app)).toMatchObject({
      requestId: res.headers['x-request-id'],
      outcome: 'success',
      model: MODEL,
      attempts: 1,
      inputTokens: 500,
      outputTokens: 80,
      costUsdMicros: 123,
      queryLength: query.length,
      filters: {
        category: 'hairdresser',
        radiusKm: null,
        priceMax: 3000,
        date: null,
        hasPlace: true,
        nearMe: false,
      },
    });
  });

  it('sortie invalide du modèle → mots-clés, avec les tokens facturés', async () => {
    extractor.extract.mockResolvedValue(answer({ ...EMPTY, category: 'spa' }));

    const { body } = await interpret(app, 'coiffeur à Lyon moins de 30 €');

    expect(body).toEqual({
      source: 'keywords',
      filters: {
        category: 'hairdresser',
        place: { label: 'Lyon', lat: 45.758, lng: 4.832 },
        priceMax: 3000,
      },
      notices: [],
    });
    expect(await lastRow(app)).toMatchObject({
      outcome: 'invalid_output',
      attempts: 1,
      model: MODEL,
      inputTokens: 500,
      outputTokens: 80,
      costUsdMicros: 123,
    });
  });

  it('erreur inattendue du modèle → mots-clés, jamais un 500', async () => {
    extractor.extract.mockRejectedValue(new Error('panne imprévue'));
    const { body } = await interpret(app, 'coiffeur à Lyon');
    expect(body.source).toBe('keywords');
    expect(await lastRow(app)).toMatchObject({
      outcome: 'upstream_error',
      attempts: 1,
      model: MODEL,
      inputTokens: null,
      costUsdMicros: null,
    });
  });

  it('clé refusée (401) → mots-clés, issue upstream_error', async () => {
    extractor.extract.mockRejectedValue(new FilterExtractorError('unauthorized', { status: 401 }));
    const { body } = await interpret(app, 'coiffeur à Lyon');
    expect(body.source).toBe('keywords');
    expect(await lastRow(app)).toMatchObject({ outcome: 'upstream_error', attempts: 1 });
  });

  describe('notices', () => {
    it('lieu introuvable → place_not_found, sans filtre de lieu', async () => {
      extractor.extract.mockResolvedValue(answer({ ...EMPTY, category: 'room', place: 'Bordo' }));
      const { body } = await interpret(app, 'salle à Bordo');
      expect(body.filters).toEqual({ category: 'room' });
      expect(body.notices).toEqual([{ type: 'place_not_found', place: 'Bordo' }]);
      expect((await lastRow(app))?.filters).toMatchObject({ hasPlace: false });
    });

    it('géocodeur en panne → place_not_found, la recherche continue', async () => {
      geocoder.search.mockRejectedValue(new GeocoderError('timeout'));
      extractor.extract.mockResolvedValue(answer({ ...EMPTY, place: 'Lyon' }));
      const { body } = await interpret(app, 'à Lyon');
      expect(body.notices).toEqual([{ type: 'place_not_found', place: 'Lyon' }]);
    });

    it('date passée → date_out_of_range ; date dans la plage → filtre', async () => {
      extractor.extract.mockResolvedValue(answer({ ...EMPTY, date: '2020-01-01' }));
      expect((await interpret(app, 'terrain le 1er janvier 2020')).body).toMatchObject({
        filters: {},
        notices: [{ type: 'date_out_of_range', date: '2020-01-01' }],
      });

      const inThreeDays = addLocalDays(localDateOf(new Date(), SEARCH_TIMEZONE), 3);
      extractor.extract.mockResolvedValue(answer({ ...EMPTY, date: inThreeDays }));
      expect((await interpret(app, 'terrain dans trois jours')).body.filters).toEqual({
        date: inThreeDays,
      });
    });

    it('rayon ramené à une option, prix décimal en centimes, morceaux ignorés tronqués', async () => {
      const ignored = ['après 18 h', ...Array.from({ length: 7 }, (_, i) => `détail ${i}`)];
      extractor.extract.mockResolvedValue(
        answer({ ...EMPTY, radiusKm: 7, priceMaxEuros: 29.9, ignored }),
      );
      const { body } = await interpret(app, 'dans 7 km pour moins de 29,90 € après 18 h');
      expect(body.filters).toEqual({ radiusKm: 5, priceMax: 2990 });
      expect(body.notices).toEqual([{ type: 'ignored_terms', terms: ignored.slice(0, 5) }]);
    });

    it('« près de moi » sans lieu → nearMe, sans appel au géocodeur', async () => {
      extractor.extract.mockResolvedValue(
        answer({ ...EMPTY, category: 'sports_field', nearMe: true }),
      );
      const { body } = await interpret(app, 'terrain près de moi');
      expect(body.filters).toEqual({ category: 'sports_field', nearMe: true });
      expect(geocoder.search).not.toHaveBeenCalled();
      expect((await lastRow(app))?.filters).toMatchObject({ nearMe: true, hasPlace: false });
    });

    it('« près de moi à Lyon » → le lieu cité l’emporte', async () => {
      extractor.extract.mockResolvedValue(answer({ ...EMPTY, place: 'Lyon', nearMe: true }));
      const { body } = await interpret(app, 'près de moi à Lyon');
      expect(body.filters).toEqual({ place: { label: 'Lyon', lat: 45.758, lng: 4.832 } });
    });
  });

  describe('validation', () => {
    it.each([
      ['2 caractères', { query: 'ab' }],
      ['2 lettres entourées d’espaces', { query: '   ab   ' }],
      ['201 caractères', { query: 'a'.repeat(201) }],
      ['sans phrase', {}],
    ])('400 VALIDATION_FAILED : %s', async (_label, body) => {
      const res = await request(app.getHttpServer())
        .post('/v1/search/interpret')
        .send(body)
        .expect(400);
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(extractor.extract).not.toHaveBeenCalled();
    });
  });
});

describe('POST /v1/search/interpret (sans clé Mistral)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp({ geocoder: { search: () => Promise.resolve([LYON]) } });
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDatabase(app);
  });

  it('démarre et analyse par mots-clés, sans appel au modèle', async () => {
    const { body } = await interpret(app, 'barbier à Lyon après 18 h');
    expect(body).toEqual({
      source: 'keywords',
      filters: { category: 'hairdresser', place: { label: 'Lyon', lat: 45.758, lng: 4.832 } },
      notices: [{ type: 'ignored_terms', terms: ['après 18 h'] }],
    });
    expect(await lastRow(app)).toMatchObject({
      outcome: 'not_configured',
      attempts: 0,
      model: null,
      latencyMs: 0,
      inputTokens: null,
      costUsdMicros: null,
    });
  });
});

describe('POST /v1/search/interpret (plafond journalier à 0 : IA coupée)', () => {
  let app: INestApplication;
  const idle = {
    configured: true,
    extract: vi.fn<FilterExtractor['extract']>(),
  } satisfies FilterExtractor;

  beforeAll(async () => {
    app = await createTestApp({ filterExtractor: idle, aiDailyCap: 0, geocoder });
  });
  afterAll(async () => {
    await app.close();
  });

  it("n'appelle pas le modèle : not_configured", async () => {
    await resetDatabase(app);
    geocoder.search.mockResolvedValue([]);
    const { body } = await interpret(app, 'coiffeur demain');
    expect(body.source).toBe('keywords');
    expect(idle.extract).not.toHaveBeenCalled();
    expect(await lastRow(app)).toMatchObject({ outcome: 'not_configured', attempts: 0 });
  });
});

describe('POST /v1/search/interpret : limite de débit', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp({
      aiRateLimit: 10,
      publicRateLimit: 5,
      geocoder: { search: () => Promise.resolve([]) },
    });
  });
  afterAll(async () => {
    await app.close();
  });

  it('429 TOO_MANY_REQUESTS au 11e appel de la minute, sans toucher à la limite des lectures publiques', async () => {
    for (let i = 0; i < 10; i++) {
      await request(app.getHttpServer())
        .post('/v1/search/interpret')
        .send({ query: 'coiffeur' })
        .expect(200);
    }
    const res = await request(app.getHttpServer())
      .post('/v1/search/interpret')
      .send({ query: 'coiffeur' })
      .expect(429);
    expect(res.body).toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    // La limite `public` (5 par minute ici) n'a pas été consommée par les 11 interprétations.
    await request(app.getHttpServer()).get('/v1/search/providers').expect(200);
  });
});
