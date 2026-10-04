import type { INestApplication } from '@nestjs/common';
import { desc, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiRequests } from '@creno/db';
import { type AiSearchExtraction, interpretResponseSchema } from '@creno/shared';
import { AiRequestsRepository } from '../src/ai-search/ai-requests.repository.js';
import {
  type ExtractionResult,
  type FilterExtractor,
  FilterExtractorError,
} from '../src/ai-search/filter-extractor.js';
import { createTestApp, dbOf, fakeClock, resetDatabase } from './app.js';

const MODEL = 'mistral-small-2603';
const OUTPUT: AiSearchExtraction = {
  category: 'hairdresser',
  place: null,
  nearMe: false,
  radiusKm: null,
  priceMaxEuros: null,
  date: null,
  ignored: [],
};
const answer = (output: unknown = OUTPUT): ExtractionResult => ({
  output,
  model: MODEL,
  usage: { inputTokens: 500, outputTokens: 80 },
});
const never = () => new Promise<never>(() => {});
const failWith = (reason: FilterExtractorError['reason'], details = {}) =>
  Promise.reject(new FilterExtractorError(reason, details));

interface LogLine {
  level: number;
  event?: string;
  [key: string]: unknown;
}

/**
 * Une application neuve par test : le circuit breaker vit en mémoire, son état ne doit pas passer
 * d'un test à l'autre. Horloge de test : les attentes avant reprise ne bloquent pas.
 */
// Un seul tableau pour tout le fichier : le logger racine de nestjs-pino est global au processus et
// reste branché sur le flux de la première application créée (voir search-logs.e2e-spec.ts).
const logs: string[] = [];

async function setup(options: { aiDailyCap?: number; aiModel?: string } = {}) {
  const extractor = { configured: true, extract: vi.fn<FilterExtractor['extract']>() };
  const clock = fakeClock();
  logs.length = 0;
  const app = await createTestApp({
    filterExtractor: extractor,
    clock,
    logs,
    aiTimeoutMs: 100,
    geocoder: { search: () => Promise.resolve([]) },
    ...options,
  });
  await resetDatabase(app);
  const events = (event: string) =>
    logs.map((line) => JSON.parse(line) as LogLine).filter((line) => line.event === event);
  return { app, extractor, clock, events };
}

let current: INestApplication | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

async function interpret(app: INestApplication, query = 'coiffeur demain') {
  const res = await request(app.getHttpServer())
    .post('/v1/search/interpret')
    .send({ query })
    .expect(200);
  return interpretResponseSchema.parse(res.body);
}

const lastRow = async (app: INestApplication) =>
  (await dbOf(app).db.select().from(aiRequests).orderBy(desc(aiRequests.createdAt)).limit(1))[0]!;

describe('recherche IA : timeout et reprise', () => {
  it('deux timeouts → mots-clés, 2 tentatives, une seule attente de 250 à 500 ms', async () => {
    const { app, extractor, clock, events } = await setup();
    current = app;
    extractor.extract.mockImplementation(never);

    expect((await interpret(app)).source).toBe('keywords');

    expect(extractor.extract).toHaveBeenCalledTimes(2);
    expect(clock.sleep).toHaveBeenCalledTimes(1);
    const delay = clock.sleep.mock.calls[0]![0];
    expect(delay).toBeGreaterThanOrEqual(250);
    expect(delay).toBeLessThanOrEqual(500);
    const row = await lastRow(app);
    expect(row).toMatchObject({ outcome: 'timeout', attempts: 2, model: MODEL, inputTokens: null });
    // Deux timeouts de 100 ms et l'attente entre eux.
    expect(row.latencyMs).toBeGreaterThanOrEqual(200 + delay);
    expect(events('ai.retry')).toMatchObject([{ level: 40, reason: 'timeout', attempt: 1 }]);
  });

  it('timeout puis succès → réponse du modèle, 2 tentatives', async () => {
    const { app, extractor } = await setup();
    current = app;
    extractor.extract.mockImplementationOnce(never).mockResolvedValueOnce(answer());

    expect((await interpret(app)).source).toBe('ai');
    expect(await lastRow(app)).toMatchObject({
      outcome: 'success',
      attempts: 2,
      costUsdMicros: 123,
    });
  });

  it('5xx ou réseau → une reprise ; deux 5xx → upstream_error', async () => {
    const { app, extractor } = await setup();
    current = app;
    extractor.extract
      .mockImplementationOnce(() => failWith('server_error', { status: 503 }))
      .mockResolvedValueOnce(answer());
    expect((await interpret(app)).source).toBe('ai');

    extractor.extract.mockReset();
    extractor.extract
      .mockImplementationOnce(() => failWith('network'))
      .mockImplementationOnce(() => failWith('server_error', { status: 502 }));
    expect((await interpret(app)).source).toBe('keywords');
    expect(extractor.extract).toHaveBeenCalledTimes(2);
    expect(await lastRow(app)).toMatchObject({ outcome: 'upstream_error', attempts: 2 });
  });

  it('429 → reprise après max(1 s, retry-after) ; délai au-delà du budget → aucune reprise', async () => {
    const { app, extractor, clock } = await setup();
    current = app;
    extractor.extract
      .mockImplementationOnce(() => failWith('rate_limited', { status: 429 }))
      .mockResolvedValueOnce(answer());
    expect((await interpret(app)).source).toBe('ai');
    expect(clock.sleep).toHaveBeenLastCalledWith(1000);

    extractor.extract
      .mockImplementationOnce(() => failWith('rate_limited', { status: 429, retryAfterMs: 2000 }))
      .mockResolvedValueOnce(answer());
    expect((await interpret(app)).source).toBe('ai');
    expect(clock.sleep).toHaveBeenLastCalledWith(2000);

    extractor.extract.mockReset();
    extractor.extract.mockImplementation(() =>
      failWith('rate_limited', { status: 429, retryAfterMs: 10_000 }),
    );
    expect((await interpret(app)).source).toBe('keywords');
    expect(extractor.extract).toHaveBeenCalledTimes(1);
    expect(await lastRow(app)).toMatchObject({ outcome: 'rate_limited', attempts: 1 });
  });

  it('400, clé refusée ou sortie invalide → aucune reprise', async () => {
    const { app, extractor, events } = await setup();
    current = app;
    extractor.extract.mockImplementation(() => failWith('bad_request', { status: 400 }));
    await interpret(app);
    expect(await lastRow(app)).toMatchObject({ outcome: 'upstream_error', attempts: 1 });
    // Requête refusée (paramètre ou modèle inconnu) : le repli masquerait une IA qui ne marche jamais.
    expect(events('ai.request').at(-1)).toMatchObject({
      level: 50,
      reason: 'bad_request',
      status: 400,
    });

    extractor.extract.mockImplementation(() => failWith('unauthorized', { status: 401 }));
    await interpret(app);
    expect(await lastRow(app)).toMatchObject({ outcome: 'upstream_error', attempts: 1 });
    // Clé refusée : action requise, donc `error` (Sentry).
    expect(events('ai.request').at(-1)).toMatchObject({
      level: 50,
      reason: 'unauthorized',
      status: 401,
    });

    extractor.extract.mockResolvedValue(answer({ ...OUTPUT, category: 'spa' }));
    await interpret(app);
    expect(await lastRow(app)).toMatchObject({ outcome: 'invalid_output', attempts: 1 });
    expect(events('ai.request').at(-1)).toMatchObject({ level: 40, invalidFields: ['category'] });
    expect(extractor.extract).toHaveBeenCalledTimes(3);
  });
});

describe('recherche IA : circuit breaker', () => {
  const failFiveTimes = async (app: INestApplication) => {
    for (let i = 0; i < 5; i++) expect((await interpret(app)).source).toBe('keywords');
  };

  it("s'ouvre après 5 interprétations en échec : le modèle n'est plus appelé", async () => {
    const { app, extractor, events } = await setup();
    current = app;
    extractor.extract.mockImplementation(() => failWith('server_error', { status: 503 }));

    await failFiveTimes(app);
    expect(extractor.extract).toHaveBeenCalledTimes(10); // une reprise par interprétation
    expect(events('ai.circuit_opened')).toMatchObject([{ level: 40, reason: 'server_error' }]);

    expect((await interpret(app)).source).toBe('keywords');
    expect(extractor.extract).toHaveBeenCalledTimes(10);
    expect(await lastRow(app)).toMatchObject({ outcome: 'circuit_open', attempts: 0, model: null });
  });

  it('après 30 s, un essai réussi le referme ; un essai raté le rouvre', async () => {
    const { app, extractor, clock, events } = await setup();
    current = app;
    extractor.extract.mockImplementation(() => failWith('timeout'));
    await failFiveTimes(app);

    clock.advance(30_000);
    extractor.extract.mockImplementation(() => failWith('network'));
    await interpret(app); // essai raté
    const calls = extractor.extract.mock.calls.length;
    await interpret(app);
    expect(extractor.extract).toHaveBeenCalledTimes(calls); // rouvert : aucun appel
    expect(await lastRow(app)).toMatchObject({ outcome: 'circuit_open' });

    clock.advance(30_000);
    extractor.extract.mockResolvedValue(answer());
    expect((await interpret(app)).source).toBe('ai');
    expect(events('ai.circuit_closed')).toHaveLength(1);
    expect((await interpret(app)).source).toBe('ai');
  });

  it('une sortie invalide ne compte pas : le modèle répond', async () => {
    const { app, extractor } = await setup();
    current = app;
    extractor.extract.mockImplementation(() => failWith('server_error', { status: 500 }));
    for (let i = 0; i < 4; i++) await interpret(app);
    extractor.extract.mockResolvedValueOnce(answer({ ...OUTPUT, category: 'spa' }));
    await interpret(app);
    for (let i = 0; i < 4; i++) await interpret(app);
    // 4 échecs, une réponse invalide, 4 échecs : toujours fermé, le modèle est encore appelé.
    const calls = extractor.extract.mock.calls.length;
    await interpret(app);
    expect(extractor.extract.mock.calls.length).toBeGreaterThan(calls);
  });

  it('une clé refusée (401) compte : 5 refus ouvrent le circuit', async () => {
    const { app, extractor } = await setup();
    current = app;
    extractor.extract.mockImplementation(() => failWith('unauthorized', { status: 401 }));
    await failFiveTimes(app);
    expect(extractor.extract).toHaveBeenCalledTimes(5); // pas de reprise sur un 401
    await interpret(app);
    expect(extractor.extract).toHaveBeenCalledTimes(5);
    expect(await lastRow(app)).toMatchObject({ outcome: 'circuit_open' });
  });

  it('circuit ouvert et plafond atteint en même temps → circuit_open', async () => {
    const { app, extractor } = await setup({ aiDailyCap: 10 });
    current = app;
    extractor.extract.mockImplementation(() => failWith('server_error', { status: 503 }));
    await failFiveTimes(app); // 10 tentatives : le plafond est atteint aussi
    await interpret(app);
    expect(await lastRow(app)).toMatchObject({ outcome: 'circuit_open', attempts: 0 });
  });
});

describe('recherche IA : plafond journalier', () => {
  const row = (attempts: number, createdAt?: ReturnType<typeof sql>) => ({
    requestId: `req-${Math.random()}`,
    outcome: 'success' as const,
    model: MODEL,
    attempts,
    latencyMs: 600,
    queryLength: 12,
    ...(createdAt ? { createdAt } : {}),
  });

  it('somme des tentatives du jour (reprises comprises) ≥ plafond → aucun appel', async () => {
    const { app, extractor, events } = await setup({ aiDailyCap: 3 });
    current = app;
    await dbOf(app)
      .db.insert(aiRequests)
      .values([row(2), row(1)]);

    expect((await interpret(app)).source).toBe('keywords');
    expect(extractor.extract).not.toHaveBeenCalled();
    expect(await lastRow(app)).toMatchObject({
      outcome: 'budget_exceeded',
      attempts: 0,
      model: null,
    });
    expect(events('ai.budget_exceeded')).toMatchObject([{ level: 40, attemptsToday: 3, cap: 3 }]);
  });

  it("ne compte pas les appels d'hier (minuit UTC)", async () => {
    const { app, extractor } = await setup({ aiDailyCap: 3 });
    current = app;
    extractor.extract.mockResolvedValue(answer());
    await dbOf(app)
      .db.insert(aiRequests)
      .values([
        row(
          2,
          sql`date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' - interval '1 minute'`,
        ),
        row(2),
      ]);

    expect((await interpret(app)).source).toBe('ai');
    expect(extractor.extract).toHaveBeenCalledTimes(1);
  });

  it('base illisible pour le plafond → pas de dépense, réponse par mots-clés', async () => {
    const { app, extractor, events } = await setup();
    current = app;
    vi.spyOn(app.get(AiRequestsRepository), 'attemptsSince').mockRejectedValueOnce(
      new Error('connexion perdue'),
    );
    expect((await interpret(app)).source).toBe('keywords');
    expect(extractor.extract).not.toHaveBeenCalled();
    expect(events('ai.budget_check_failed')).toMatchObject([{ level: 50 }]);
  });
});

describe('recherche IA : robustesse du journal et du coût', () => {
  it("échec d'écriture dans ai_requests → la réponse part quand même", async () => {
    const { app, extractor, events } = await setup();
    current = app;
    extractor.extract.mockResolvedValue(answer());
    vi.spyOn(app.get(AiRequestsRepository), 'insert').mockRejectedValueOnce(
      new Error('disque plein'),
    );

    expect((await interpret(app)).source).toBe('ai');
    expect(events('ai.persist_failed')).toMatchObject([{ level: 50 }]);
  });

  it('modèle absent de la table de prix → coût null, un seul warn', async () => {
    const { app, extractor, events } = await setup({ aiModel: 'mistral-medium-2508' });
    current = app;
    extractor.extract.mockResolvedValue(answer());
    await interpret(app);
    await interpret(app);
    expect(await lastRow(app)).toMatchObject({
      outcome: 'success',
      costUsdMicros: null,
      inputTokens: 500,
    });
    expect(events('ai.price_unknown')).toMatchObject([{ level: 40, model: 'mistral-medium-2508' }]);
  });
});
