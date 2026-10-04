import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { aiRequests } from '@creno/db';
import {
  AI_QUERY_MAX,
  type AiSearchExtraction,
  type GeocodingResult,
  interpretResponseSchema,
} from '@creno/shared';
import {
  type ExtractionResult,
  type FilterExtractor,
  FilterExtractorError,
} from '../src/ai-search/filter-extractor.js';
import { MistralFilterExtractor } from '../src/ai-search/mistral-filter-extractor.js';
import { type Geocoder, GeocoderError } from '../src/geocoding/geocoder.js';
import { createTestApp, dbOf, fakeClock, resetDatabase } from './app.js';

const MODEL = 'mistral-small-2603';
// Des mots qu'on ne trouve nulle part ailleurs, pour que leur présence dans un log ne doive rien au hasard.
const QUERY = 'Coiffeur Zéphyrine à Quimperlé samedi, moins de 30 €, après 18 h pour 3 personnes';
const QUIMPERLE: GeocodingResult = {
  label: 'Quimperlé',
  name: 'Quimperlé',
  city: 'Quimperlé',
  postcode: '29300',
  latitude: 47.872,
  longitude: -3.549,
  kind: 'city',
};
/** Ni la phrase, ni un de ses morceaux, ni le lieu (écrit ou sans accent), ni ses coordonnées. */
const SECRETS = [
  QUERY,
  'Zéphyrine',
  'zephyrine',
  'Quimperl',
  'quimperle',
  'après 18',
  '3 personnes',
  '47.87',
  '3.549',
];

const OUTPUT: AiSearchExtraction = {
  category: 'hairdresser',
  place: 'Quimperlé',
  nearMe: false,
  radiusKm: null,
  priceMaxEuros: 30,
  date: null,
  ignored: ['après 18 h', 'pour 3 personnes', 'Zéphyrine'],
};
const answer = (output: unknown): ExtractionResult => ({
  output,
  model: MODEL,
  usage: { inputTokens: 500, outputTokens: 80 },
});

interface LogLine {
  level: number;
  event?: string;
  outcome?: string;
  status?: number;
  invalidFields?: string[];
}

// Fichier à part, comme auth-logs : le logger racine de nestjs-pino est global au processus.
describe('recherche en langage naturel : aucune phrase ni lieu dans les logs et ai_requests', () => {
  let app: INestApplication;
  const logs: string[] = [];
  const extractor = { configured: true, extract: vi.fn<FilterExtractor['extract']>() };
  const geocoder = { search: vi.fn<Geocoder['search']>() } satisfies Geocoder;

  beforeAll(async () => {
    app = await createTestApp({
      filterExtractor: extractor,
      geocoder,
      logs,
      // Timeout court, et horloge de test : l'attente avant la reprise ne bloque pas.
      aiTimeoutMs: 100,
      clock: fakeClock(),
    });
    await resetDatabase(app);
  });
  afterAll(async () => {
    await app.close();
  });

  const interpret = async (query = QUERY) => {
    const res = await request(app.getHttpServer())
      .post('/v1/search/interpret')
      .send({ query })
      .expect(200);
    return interpretResponseSchema.parse(res.body);
  };
  const lines = () => logs.map((line) => JSON.parse(line) as LogLine);
  const lastRequestLog = () =>
    lines()
      .filter((line) => line.event === 'ai.request')
      .at(-1);

  /** Vérifié après chaque chemin : les logs accumulés et toutes les lignes de `ai_requests`. */
  async function expectNothingPersonal(): Promise<void> {
    const all = logs.join('\n');
    const rows = JSON.stringify(await dbOf(app).db.select().from(aiRequests));
    for (const secret of SECRETS) {
      expect(all).not.toContain(secret);
      expect(rows).not.toContain(secret);
    }
  }

  it('succès : seuls des mesures et des filtres non localisants sont gardés', async () => {
    extractor.extract.mockResolvedValue(answer(OUTPUT));
    geocoder.search.mockResolvedValue([QUIMPERLE]);

    const body = await interpret();
    // Le visiteur, lui, reçoit le lieu et ce qui a été ignoré.
    expect(body.filters.place?.label).toBe('Quimperlé');
    expect(lastRequestLog()).toMatchObject({ level: 30, outcome: 'success' });
    await expectNothingPersonal();
  });

  it('timeout : repli par mots-clés, qui géocodent aussi le lieu', async () => {
    extractor.extract.mockImplementation(() => new Promise<never>(() => {}));
    geocoder.search.mockResolvedValue([QUIMPERLE]);

    const body = await interpret();
    expect(body).toMatchObject({ source: 'keywords', filters: { place: { label: 'Quimperlé' } } });
    expect(lastRequestLog()).toMatchObject({ outcome: 'timeout' });
    expect(lines().some((line) => line.event === 'ai.retry')).toBe(true);
    await expectNothingPersonal();
  });

  it('sortie invalide qui recopie la phrase : le chemin du champ, jamais sa valeur', async () => {
    extractor.extract.mockResolvedValue(answer({ ...OUTPUT, category: QUERY }));

    expect((await interpret()).source).toBe('keywords');
    expect(lastRequestLog()).toMatchObject({
      outcome: 'invalid_output',
      invalidFields: ['category'],
    });
    await expectNothingPersonal();
  });

  it("erreur inattendue dont le message contient la phrase : seul le nom de l'erreur", async () => {
    extractor.extract.mockRejectedValue(new Error(`Échec de l'analyse de « ${QUERY} »`));

    expect((await interpret()).source).toBe('keywords');
    expect(lines().some((line) => line.event === 'ai.unexpected_error')).toBe(true);
    expect(lastRequestLog()).toMatchObject({ outcome: 'upstream_error' });
    await expectNothingPersonal();
  });

  it('422 du fournisseur qui recopie la phrase, par le vrai adapter Mistral', async () => {
    const echo = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ message: QUERY, detail: [{ msg: 'invalid', input: QUERY }] }),
          { status: 422, headers: { 'content-type': 'application/json' } },
        ),
      );
    // Fausse clé construite à l'exécution : aucune chaîne en forme de secret dans le dépôt.
    const mistral = new MistralFilterExtractor(randomBytes(16).toString('hex'), MODEL, echo);
    extractor.extract.mockImplementation((req, signal) => mistral.extract(req, signal));

    expect((await interpret()).source).toBe('keywords');
    expect(lastRequestLog()).toMatchObject({ outcome: 'upstream_error', status: 422 });
    await expectNothingPersonal();
  });

  it('erreur du fournisseur porteuse de la phrase dans sa cause', async () => {
    const error = new FilterExtractorError('server_error', { status: 500 });
    Object.assign(error, { cause: new Error(QUERY) });
    extractor.extract.mockRejectedValue(error);

    expect((await interpret()).source).toBe('keywords');
    expect(lastRequestLog()).toMatchObject({ outcome: 'upstream_error' });
    await expectNothingPersonal();
  });

  it('géocodeur en panne : notice pour le visiteur, raison seule dans le log', async () => {
    extractor.extract.mockResolvedValue(answer(OUTPUT));
    geocoder.search.mockRejectedValue(new GeocoderError('timeout'));

    const body = await interpret();
    expect(body.notices).toContainEqual({ type: 'place_not_found', place: 'Quimperlé' });
    expect(lines().some((line) => line.event === 'ai.geocoding_failed')).toBe(true);
    await expectNothingPersonal();
  });

  it('phrase refusée par la validation : 400, sans la recopier', async () => {
    const tooLong = `${QUERY} ${'x'.repeat(AI_QUERY_MAX)}`;
    await request(app.getHttpServer())
      .post('/v1/search/interpret')
      .send({ query: tooLong })
      .expect(400);
    await expectNothingPersonal();
  });
});
