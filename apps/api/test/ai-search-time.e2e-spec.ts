import type { INestApplication } from '@nestjs/common';
import { desc } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiRequests } from '@creno/db';
import {
  type AiSearchExtraction,
  type InterpretResponse,
  interpretResponseSchema,
} from '@creno/shared';
import type { Clock } from '../src/common/clock.js';
import type { ExtractionResult, FilterExtractor } from '../src/ai-search/filter-extractor.js';
import type { Geocoder } from '../src/geocoding/geocoder.js';
import { createTestApp, dbOf, resetDatabase } from './app.js';

// Vendredi 16 octobre 2026 à l'heure de Paris (UTC+2) ; le lundi suivant est le 19.
const FRIDAY = '2026-10-16';
const MONDAY = '2026-10-19';
const at = (time: string) => new Date(`${FRIDAY}T${time}:00+02:00`).getTime();

const EMPTY: AiSearchExtraction = {
  category: null,
  place: null,
  nearMe: false,
  radiusKm: null,
  priceMaxEuros: null,
  date: null,
  timeOfDay: null,
  startAfter: null,
  startBefore: null,
  ignored: [],
};

const answer = (output: Partial<AiSearchExtraction>): ExtractionResult => ({
  output: { ...EMPTY, category: 'hairdresser', ...output },
  model: 'mistral-small-2603',
  usage: { inputTokens: 500, outputTokens: 80 },
});

const extractor = {
  configured: true,
  extract: vi.fn<FilterExtractor['extract']>(),
} satisfies FilterExtractor;
const geocoder = { search: vi.fn<Geocoder['search']>(async () => []) } satisfies Geocoder;

let now = at('10:00');
const clock: Clock = { now: () => now, sleep: async () => {} };

describe('POST /v1/search/interpret : plage horaire', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp({ filterExtractor: extractor, geocoder, clock });
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDatabase(app);
    extractor.extract.mockReset();
    now = at('10:00');
  });

  async function interpret(query: string): Promise<InterpretResponse> {
    const res = await request(app.getHttpServer())
      .post('/v1/search/interpret')
      .send({ query })
      .expect(200);
    return interpretResponseSchema.parse(res.body);
  }

  const lastRow = async () =>
    (await dbOf(app).db.select().from(aiRequests).orderBy(desc(aiRequests.createdAt)).limit(1))[0];

  it('une période et un jour → les bornes de la période, enregistrées dans le journal', async () => {
    extractor.extract.mockResolvedValue(answer({ date: MONDAY, timeOfDay: 'afternoon' }));

    const body = await interpret('un coiffeur pour lundi après-midi');

    expect(body).toEqual({
      source: 'ai',
      filters: { category: 'hairdresser', date: MONDAY, timeFrom: '12:00', timeTo: '18:00' },
      notices: [],
    });
    expect(await lastRow()).toMatchObject({
      outcome: 'success',
      filters: { date: MONDAY, timeFrom: '12:00', timeTo: '18:00' },
    });
  });

  it('période resserrée par les heures citées (« le soir avant 20 h »)', async () => {
    extractor.extract.mockResolvedValue(
      answer({ date: MONDAY, timeOfDay: 'evening', startBefore: '20:00' }),
    );

    const { filters } = await interpret('coiffeur lundi soir avant 20 h');
    expect(filters).toMatchObject({ timeFrom: '18:00', timeTo: '20:00' });
  });

  it("une heure sans jour → aujourd'hui tant que la plage n'est pas finie", async () => {
    extractor.extract.mockResolvedValue(answer({ startAfter: '18:00' }));

    const { filters } = await interpret('coiffeur après 18 h');
    expect(filters).toEqual({ category: 'hairdresser', date: FRIDAY, timeFrom: '18:00' });
  });

  it('une plage déjà finie sans jour → demain (« le matin » tapé à 15 h)', async () => {
    now = at('15:00');
    extractor.extract.mockResolvedValue(answer({ timeOfDay: 'morning' }));

    const { filters } = await interpret('coiffeur le matin');
    expect(filters).toEqual({ category: 'hairdresser', date: '2026-10-17', timeTo: '12:00' });
  });

  it('jour manqué par le modèle mais cité dans la phrase → le jour cité', async () => {
    extractor.extract.mockResolvedValue(answer({ timeOfDay: 'afternoon' }));

    const { filters } = await interpret('un coiffeur pour lundi après-midi');
    expect(filters).toMatchObject({ date: MONDAY, timeFrom: '12:00', timeTo: '18:00' });
  });

  it("heures inversées → ignorées, le reste de l'interprétation est gardé", async () => {
    extractor.extract.mockResolvedValue(
      answer({ date: MONDAY, startAfter: '18:00', startBefore: '12:00' }),
    );

    const body = await interpret('coiffeur lundi entre 18 h et 12 h');
    expect(body).toEqual({
      source: 'ai',
      filters: { category: 'hairdresser', date: MONDAY },
      notices: [],
    });
    expect(await lastRow()).toMatchObject({
      outcome: 'success',
      filters: { timeFrom: null, timeTo: null },
    });
  });

  it('jour cité hors horizon → ni jour ni plage, pas de repli sur aujourd’hui', async () => {
    extractor.extract.mockResolvedValue(answer({ date: '2026-10-12', startAfter: '18:00' }));

    const body = await interpret('coiffeur le 12/10 après 18 h');
    expect(body.filters).toEqual({ category: 'hairdresser' });
    expect(body.notices).toEqual([{ type: 'date_out_of_range', date: '2026-10-12' }]);
  });

  it('par mots-clés (modèle en panne) : « après 18 h » devient une plage, plus un morceau ignoré', async () => {
    extractor.extract.mockRejectedValue(new Error('panne imprévue'));

    const body = await interpret('barbier après 18 h');
    expect(body).toEqual({
      source: 'keywords',
      filters: { category: 'hairdresser', date: FRIDAY, timeFrom: '18:00' },
      notices: [],
    });
  });

  it('par mots-clés : la phrase de l’étape 9, « un coiffeur sur paris pour lundi après midi »', async () => {
    extractor.extract.mockRejectedValue(new Error('panne imprévue'));
    geocoder.search.mockResolvedValueOnce([
      {
        label: 'Paris',
        name: 'Paris',
        city: 'Paris',
        postcode: '75001',
        latitude: 48.859,
        longitude: 2.347,
        kind: 'city',
      },
    ]);

    const body = await interpret('un coiffeur sur paris pour lundi après midi');
    expect(body.filters).toEqual({
      category: 'hairdresser',
      place: { label: 'Paris', lat: 48.859, lng: 2.347 },
      date: MONDAY,
      timeFrom: '12:00',
      timeTo: '18:00',
    });
    expect(body.notices).toEqual([]);
  });
});
