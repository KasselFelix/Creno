import { describe, expect, it, vi } from 'vitest';
import { FilterExtractorError } from './filter-extractor.js';
import { MistralFilterExtractor } from './mistral-filter-extractor.js';
import { SYSTEM_PROMPT } from './prompt.js';

// Fausse clé construite à l'exécution : aucune chaîne en forme de secret dans le dépôt.
const API_KEY = 'k'.repeat(32);
const MODEL = 'mistral-small-2603';
const REQUEST = { query: 'coiffeur à Lyon moins de 30 €', today: '2026-10-04' };
const OUTPUT = {
  category: 'hairdresser',
  place: 'Lyon',
  nearMe: false,
  radiusKm: null,
  priceMaxEuros: 30,
  date: null,
  ignored: [],
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/** Réponse de l'API Mistral, au format du fil (snake_case). */
const completion = (
  content: unknown,
  { finishReason = 'stop', promptTokens = 512, completionTokens = 64 } = {},
) =>
  json({
    id: 'cmpl-test',
    object: 'chat.completion',
    model: MODEL,
    created: 1_791_000_000,
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finishReason }],
  });

function extractorWith(fetchFn: typeof fetch) {
  return new MistralFilterExtractor(API_KEY, MODEL, fetchFn);
}

const run = (fetchFn: typeof fetch, signal = new AbortController().signal) =>
  extractorWith(fetchFn).extract(REQUEST, signal);

/** Erreur levée par `promise`, pour inspecter sa raison et ses détails. */
async function failureOf(promise: Promise<unknown>): Promise<FilterExtractorError> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(FilterExtractorError);
  return error as FilterExtractorError;
}

describe('MistralFilterExtractor', () => {
  it('demande une sortie JSON stricte, sans raisonnement ni reprise, et lit la réponse', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(completion(JSON.stringify(OUTPUT)));

    const result = await run(fetchFn);

    expect(result).toEqual({
      output: OUTPUT,
      model: MODEL,
      usage: { inputTokens: 512, outputTokens: 64 },
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const request = fetchFn.mock.calls[0]![0] as Request;
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`);
    const body = (await request.json()) as Record<string, unknown> & {
      messages: { role: string; content: string }[];
      response_format: { type: string; json_schema: { strict: boolean } };
    };
    expect(body).toMatchObject({ model: MODEL, temperature: 0, reasoning_effort: 'none' });
    expect(body.messages[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT });
    expect(body.messages[1]!.content).toContain(`<requete>${REQUEST.query}</requete>`);
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(JSON.stringify(body.response_format)).toContain('"additionalProperties":false');
  });

  it("n'envoie pas reasoning_effort à un modèle qui ne raisonne pas (il refuserait la requête)", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(completion(JSON.stringify(OUTPUT)));
    await new MistralFilterExtractor(API_KEY, 'ministral-8b-2512', fetchFn).extract(
      REQUEST,
      new AbortController().signal,
    );
    const body = (await (fetchFn.mock.calls[0]![0] as Request).json()) as Record<string, unknown>;
    expect(body).toMatchObject({ model: 'ministral-8b-2512', temperature: 0 });
    expect(body).not.toHaveProperty('reasoning_effort');
  });

  it('lit aussi une réponse découpée en morceaux de texte', async () => {
    const chunks = [{ type: 'text', text: JSON.stringify(OUTPUT) }];
    const result = await run(vi.fn<typeof fetch>().mockResolvedValue(completion(chunks)));
    expect(result.output).toEqual(OUTPUT);
  });

  it.each([
    ['coupée', completion(JSON.stringify(OUTPUT).slice(0, 20), { finishReason: 'length' })],
    ['vide', completion('')],
    ['qui n’est pas du JSON', completion('Voici les filtres : coiffeur')],
  ])(
    'réponse %s → invalid_output, avec le modèle et les tokens facturés',
    async (_label, response) => {
      const error = await failureOf(run(vi.fn<typeof fetch>().mockResolvedValue(response)));
      expect(error.reason).toBe('invalid_output');
      expect(error.details).toMatchObject({
        model: MODEL,
        usage: { inputTokens: 512, outputTokens: 64 },
      });
    },
  );

  it('réponse 200 que le SDK ne sait pas lire → invalid_output', async () => {
    const error = await failureOf(run(vi.fn<typeof fetch>().mockResolvedValue(json({ id: 1 }))));
    expect(error.reason).toBe('invalid_output');
  });

  it('429 → rate_limited avec le délai demandé, sans reprise par le SDK', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        json({ message: 'Requests rate limit exceeded' }, 429, { 'retry-after': '2' }),
      );
    const error = await failureOf(run(fetchFn));
    expect(error.reason).toBe('rate_limited');
    expect(error.details).toEqual({ status: 429, retryAfterMs: 2000 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [400, 'bad_request'],
    [422, 'bad_request'],
    [500, 'server_error'],
    [503, 'server_error'],
  ])('%i → %s, une seule tentative', async (status, reason) => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json({ detail: 'erreur' }, status));
    const error = await failureOf(run(fetchFn));
    expect(error.reason).toBe(reason);
    expect(error.details.status).toBe(status);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("ne recopie jamais le message du fournisseur (une 422 peut contenir l'entrée)", async () => {
    const echo = { detail: [{ msg: 'invalid', input: REQUEST.query }] };
    const error = await failureOf(run(vi.fn<typeof fetch>().mockResolvedValue(json(echo, 422))));
    expect(error.message).not.toContain('coiffeur');
    expect(JSON.stringify(error.details)).not.toContain('coiffeur');
  });

  it('signal interrompu (timeout du service) → timeout', async () => {
    const hanging = vi.fn<typeof fetch>(
      (input) =>
        new Promise((_resolve, reject) => {
          const { signal } = input as Request;
          signal.addEventListener('abort', () => reject(signal.reason as Error));
        }),
    );
    const error = await failureOf(run(hanging, AbortSignal.timeout(20)));
    expect(error.reason).toBe('timeout');
  });

  it('serveur injoignable → network', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
    const error = await failureOf(run(fetchFn));
    expect(error.reason).toBe('network');
  });
});
