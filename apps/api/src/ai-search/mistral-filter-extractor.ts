import { Mistral } from '@mistralai/mistralai';
import { HTTPClient } from '@mistralai/mistralai/lib/http.js';
import type { ChatCompletionResponse } from '@mistralai/mistralai/models/components';
import * as errors from '@mistralai/mistralai/models/errors';
import { aiSearchExtractionSchema } from '@creno/shared';
import { z } from 'zod';
import {
  type ExtractionRequest,
  type ExtractionResult,
  type ExtractionUsage,
  type FilterExtractor,
  FilterExtractorError,
} from './filter-extractor.js';
import { buildUserMessage, SYSTEM_PROMPT } from './prompt.js';

/** Schéma imposé à la réponse : tous les champs requis, `null` explicite, aucun champ en plus. */
const OUTPUT_SCHEMA = z.toJSONSchema(aiSearchExtractionSchema);
/** Une sortie complète tient en une centaine de tokens : au-delà, elle est coupée (`length`). */
const MAX_OUTPUT_TOKENS = 400;

/**
 * Extracteur Mistral (offre gratuite « Experiment » ou payante, même code). Un seul appel par
 * `extract` : les reprises, le timeout global et le circuit breaker sont gérés par le service, pour
 * qu'il les compte et les journalise. Voir docs/adr/0013-ai-search-mistral.md.
 */
export class MistralFilterExtractor implements FilterExtractor {
  readonly configured = true;
  private readonly client: Mistral;

  constructor(
    apiKey: string,
    private readonly model: string,
    /** Remplace `fetch` dans les tests : aucun appel réseau. */
    fetchFn?: typeof fetch,
  ) {
    this.client = new Mistral({
      apiKey,
      ...(fetchFn ? { httpClient: new HTTPClient({ fetcher: fetchFn }) } : {}),
    });
  }

  async extract(request: ExtractionRequest, signal: AbortSignal): Promise<ExtractionResult> {
    let response: ChatCompletionResponse;
    try {
      response = await this.client.chat.complete(
        {
          model: this.model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: buildUserMessage(request) },
          ],
          // Extraction : même phrase, même réponse ; pas de raisonnement (latence et texte simple).
          temperature: 0,
          reasoningEffort: 'none',
          maxTokens: MAX_OUTPUT_TOKENS,
          responseFormat: {
            type: 'json_schema',
            jsonSchema: { name: 'search_filters', schemaDefinition: OUTPUT_SCHEMA, strict: true },
          },
        },
        { retries: { strategy: 'none' }, signal },
      );
    } catch (error) {
      throw toExtractorError(error);
    }

    const usage: ExtractionUsage = {
      inputTokens: response.usage.promptTokens ?? null,
      outputTokens: response.usage.completionTokens ?? null,
    };
    const failure = { model: response.model, usage };
    const choice = response.choices[0];
    const text = textOf(choice?.message?.content);
    // Réponse coupée (`length`), en erreur ou vide : inutilisable, mais facturée.
    if (!choice || choice.finishReason !== 'stop' || !text) {
      throw new FilterExtractorError('invalid_output', failure);
    }
    try {
      return { output: JSON.parse(text) as unknown, model: response.model, usage };
    } catch {
      throw new FilterExtractorError('invalid_output', failure);
    }
  }
}

type MessageContent = NonNullable<
  NonNullable<ChatCompletionResponse['choices'][number]['message']>['content']
>;

/** Texte de la réponse : une chaîne, ou des morceaux dont on garde ceux de type texte. */
function textOf(content: MessageContent | null | undefined): string {
  if (typeof content === 'string') return content.trim();
  if (!content) return '';
  return content
    .map((chunk) => (chunk.type === 'text' ? chunk.text : ''))
    .join('')
    .trim();
}

/** Délai demandé par l'en-tête `retry-after` (secondes ou date HTTP). */
function retryAfterMs(headers: Headers): number | undefined {
  const value = headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

/** Traduit une erreur du SDK en raison loggable. Le message du fournisseur n'est jamais repris. */
function toExtractorError(error: unknown): FilterExtractorError {
  if (error instanceof errors.RequestTimeoutError || error instanceof errors.RequestAbortedError) {
    return new FilterExtractorError('timeout');
  }
  if (error instanceof errors.ConnectionError) return new FilterExtractorError('network');
  // Erreur HTTP, ou réponse que le SDK n'a pas su lire (`ResponseValidationError`, qui en hérite).
  if (error instanceof errors.MistralError) {
    const status = error.statusCode;
    if (status < 300) return new FilterExtractorError('invalid_output');
    if (status === 429) {
      return new FilterExtractorError('rate_limited', {
        status,
        retryAfterMs: retryAfterMs(error.headers),
      });
    }
    if (status === 401 || status === 403)
      return new FilterExtractorError('unauthorized', { status });
    if (status >= 500) return new FilterExtractorError('server_error', { status });
    return new FilterExtractorError('bad_request', { status });
  }
  // Requête refusée par le SDK lui-même (bug chez nous) ou erreur client inattendue.
  if (error instanceof errors.SDKValidationError || error instanceof errors.InvalidRequestError) {
    return new FilterExtractorError('bad_request');
  }
  return new FilterExtractorError('network');
}
