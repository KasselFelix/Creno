import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  type AiSearchExtraction,
  aiSearchExtractionSchema,
  type InterpretNotice,
  type InterpretResponse,
  isSearchDateInRange,
  roundCoordinate,
  SEARCH_TIMEZONE,
} from '@creno/shared';
import { localDateOf } from '../availability/slots.engine.js';
import { describeError } from '../common/all-exceptions.filter.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { GEOCODER, type Geocoder, GeocoderError } from '../geocoding/geocoder.js';
import { type AiRequestOutcome, AiRequestsRepository } from './ai-requests.repository.js';
import {
  AI_FILTER_EXTRACTOR,
  type ExtractionRequest,
  type ExtractionUsage,
  type FilterExtractor,
  FilterExtractorError,
  type FilterExtractorFailure,
} from './filter-extractor.js';
import {
  costUsdMicros,
  eurosToCents,
  hasKnownPrice,
  snapRadiusKm,
  truncateIgnored,
} from './interpretation.js';
import { fold, parseKeywords } from './keyword-parser.js';

type Source = InterpretResponse['source'];

/** Ce que l'appel au modèle a donné, de quoi remplir la ligne `ai_requests` et le log. */
interface ModelCall {
  outcome: AiRequestOutcome;
  /** Filtres validés, seulement si `outcome` vaut `success`. */
  extraction: AiSearchExtraction | null;
  model: string | null;
  attempts: number;
  /** Durée des appels au modèle, 0 sans appel. */
  latencyMs: number;
  usage: ExtractionUsage | null;
  reason?: FilterExtractorFailure | 'unexpected';
  status?: number;
  /** Sortie invalide : chemins des champs refusés par Zod (jamais leurs valeurs). */
  invalidFields?: string[];
}

const NO_CALL = { extraction: null, model: null, attempts: 0, latencyMs: 0, usage: null } as const;

const OUTCOME_BY_REASON: Record<FilterExtractorFailure | 'unexpected', AiRequestOutcome> = {
  not_configured: 'not_configured',
  timeout: 'timeout',
  rate_limited: 'rate_limited',
  invalid_output: 'invalid_output',
  network: 'upstream_error',
  unauthorized: 'upstream_error',
  bad_request: 'upstream_error',
  server_error: 'upstream_error',
  unexpected: 'upstream_error',
};

/**
 * Recherche en langage naturel : une phrase devient des filtres, jamais du SQL. Le modèle propose,
 * le schéma Zod valide, le géocodeur place le lieu ; en cas d'échec du modèle, l'analyse par
 * mots-clés prend le relais. Aucune défaillance du modèle ne donne une erreur 5xx.
 */
@Injectable()
export class AiSearchService implements OnModuleInit {
  private readonly logger = new Logger(AiSearchService.name);
  private readonly unpricedModelsLogged = new Set<string>();

  constructor(
    @Inject(AI_FILTER_EXTRACTOR) private readonly extractor: FilterExtractor,
    @Inject(GEOCODER) private readonly geocoder: Geocoder,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly requests: AiRequestsRepository,
  ) {}

  onModuleInit(): void {
    // Sans clé, la recherche marche par mots-clés : en production, c'est sans doute un oubli.
    if (this.config.NODE_ENV === 'production' && !this.extractor.configured) {
      this.logger.warn({ event: 'ai.not_configured' });
    }
  }

  async interpret(query: string, requestId: string, now = new Date()): Promise<InterpretResponse> {
    const startedAt = Date.now();
    const today = localDateOf(now, SEARCH_TIMEZONE);

    const call = await this.callModel({ query, today });
    const source: Source = call.extraction ? 'ai' : 'keywords';
    const extraction = call.extraction ?? parseKeywords(query, today);
    const { filters, notices } = await this.toFilters(extraction, source, today);

    const cost = call.model && call.usage ? this.costOf(call.usage) : null;
    await this.record({
      requestId,
      outcome: call.outcome,
      model: call.model,
      attempts: call.attempts,
      latencyMs: call.latencyMs,
      inputTokens: call.usage?.inputTokens ?? null,
      outputTokens: call.usage?.outputTokens ?? null,
      costUsdMicros: cost,
      queryLength: query.length,
      filters: {
        category: filters.category ?? null,
        radiusKm: filters.radiusKm ?? null,
        priceMax: filters.priceMax ?? null,
        date: filters.date ?? null,
        hasPlace: filters.place !== undefined,
        nearMe: filters.nearMe === true,
      },
    });

    // Ni la phrase, ni le lieu, ni les morceaux ignorés : seulement des mesures.
    const level =
      call.outcome === 'success' ? 'log' : call.reason === 'unauthorized' ? 'error' : 'warn';
    this.logger[level]({
      event: 'ai.request',
      outcome: call.outcome,
      source,
      model: call.model,
      attempts: call.attempts,
      latencyMs: call.latencyMs,
      durationMs: Date.now() - startedAt,
      inputTokens: call.usage?.inputTokens ?? null,
      outputTokens: call.usage?.outputTokens ?? null,
      costUsdMicros: cost,
      ...(call.reason && call.reason !== 'not_configured' ? { reason: call.reason } : {}),
      ...(call.status === undefined ? {} : { status: call.status }),
      ...(call.invalidFields ? { invalidFields: call.invalidFields } : {}),
    });
    return { source, filters, notices };
  }

  private isConfigured(): boolean {
    return this.extractor.configured && this.config.AI_DAILY_REQUEST_CAP > 0;
  }

  /** Un appel au modèle, coupé au bout de `AI_TIMEOUT_MS`, et sa sortie validée par Zod. */
  private async callModel(request: ExtractionRequest): Promise<ModelCall> {
    if (!this.isConfigured()) return { outcome: 'not_configured', ...NO_CALL };

    const startedAt = Date.now();
    const elapsed = () => Date.now() - startedAt;
    try {
      const result = await withTimeout(
        (signal) => this.extractor.extract(request, signal),
        this.config.AI_TIMEOUT_MS,
      );
      const parsed = aiSearchExtractionSchema.safeParse(result.output);
      return {
        outcome: parsed.success ? 'success' : 'invalid_output',
        extraction: parsed.success ? parsed.data : null,
        model: result.model,
        attempts: 1,
        latencyMs: elapsed(),
        usage: result.usage,
        ...(parsed.success
          ? {}
          : {
              reason: 'invalid_output' as const,
              invalidFields: parsed.error.issues.map((issue) => issue.path.join('.')),
            }),
      };
    } catch (error) {
      if (error instanceof FilterExtractorError && error.reason === 'not_configured') {
        return { outcome: 'not_configured', ...NO_CALL };
      }
      // Une erreur inattendue (bug de l'adapter ou du SDK) donne aussi un repli, jamais un 500.
      const reason = error instanceof FilterExtractorError ? error.reason : 'unexpected';
      const details = error instanceof FilterExtractorError ? error.details : {};
      if (reason === 'unexpected') {
        this.logger.warn({
          event: 'ai.unexpected_error',
          err: { name: describeError(error).name },
        });
      }
      return {
        outcome: OUTCOME_BY_REASON[reason],
        extraction: null,
        // Le modèle qui a répondu, ou celui qu'on a appelé.
        model: details.model ?? this.config.AI_MODEL,
        attempts: 1,
        latencyMs: elapsed(),
        usage: details.usage ?? null,
        reason,
        ...(details.status === undefined ? {} : { status: details.status }),
      };
    }
  }

  /** Extraction → filtres de la page et notices pour le visiteur. */
  private async toFilters(
    extraction: AiSearchExtraction,
    source: Source,
    today: string,
  ): Promise<Pick<InterpretResponse, 'filters' | 'notices'>> {
    const filters: InterpretResponse['filters'] = {};
    const notices: InterpretNotice[] = [];

    if (extraction.category) filters.category = extraction.category;
    if (extraction.place) {
      const place = await this.geocode(extraction.place, source);
      if (place) filters.place = place;
      else notices.push({ type: 'place_not_found', place: extraction.place });
    } else if (extraction.nearMe) {
      // Seulement sans lieu cité : « près de moi à Lyon » cherche à Lyon.
      filters.nearMe = true;
    }
    if (extraction.radiusKm !== null) filters.radiusKm = snapRadiusKm(extraction.radiusKm);
    if (extraction.priceMaxEuros !== null) {
      filters.priceMax = eurosToCents(extraction.priceMaxEuros);
    }
    if (extraction.date !== null) {
      if (isSearchDateInRange(extraction.date, today)) filters.date = extraction.date;
      else notices.push({ type: 'date_out_of_range', date: extraction.date });
    }
    const ignored = truncateIgnored(extraction.ignored);
    if (ignored.length > 0) notices.push({ type: 'ignored_terms', terms: ignored });
    return { filters, notices };
  }

  /**
   * Position du lieu cité. Le modèle recopie un nom de lieu : on prend le premier résultat. Les
   * mots-clés peuvent attraper un faux lieu : on ne le garde que si c'est une commune, ou un libellé
   * qui contient le texte cherché. Géocodeur en panne : pas de lieu, la recherche continue.
   */
  private async geocode(
    place: string,
    source: Source,
  ): Promise<InterpretResponse['filters']['place']> {
    try {
      const [first] = await this.geocoder.search(place, 1);
      if (!first) return undefined;
      if (
        source === 'keywords' &&
        first.kind !== 'city' &&
        !fold(first.label).includes(fold(place))
      ) {
        return undefined;
      }
      return {
        label: first.kind === 'city' && first.city ? first.city : first.label,
        lat: roundCoordinate(first.latitude),
        lng: roundCoordinate(first.longitude),
      };
    } catch (error) {
      if (!(error instanceof GeocoderError)) throw error;
      this.logger.warn({ event: 'ai.geocoding_failed', reason: error.reason });
      return undefined;
    }
  }

  private costOf(usage: ExtractionUsage): number | null {
    const model = this.config.AI_MODEL;
    if (!hasKnownPrice(model) && !this.unpricedModelsLogged.has(model)) {
      this.unpricedModelsLogged.add(model);
      this.logger.warn({ event: 'ai.price_unknown', model });
    }
    return costUsdMicros(model, usage);
  }

  /** Le journal ne doit jamais faire échouer une recherche. */
  private async record(row: Parameters<AiRequestsRepository['insert']>[0]): Promise<void> {
    try {
      await this.requests.insert(row);
    } catch (error) {
      this.logger.error({ event: 'ai.persist_failed', err: describeError(error) });
    }
  }
}

/**
 * Exécute `run` avec un signal qui s'interrompt au bout de `timeoutMs`, et n'attend pas plus
 * longtemps, même si `run` ignore le signal.
 */
async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new FilterExtractorError('timeout'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
