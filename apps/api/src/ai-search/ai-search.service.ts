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
import { CLOCK, type Clock } from '../common/clock.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { GEOCODER, type Geocoder, GeocoderError } from '../geocoding/geocoder.js';
import { type AiRequestOutcome, AiRequestsRepository } from './ai-requests.repository.js';
import { CircuitBreaker } from './circuit-breaker.js';
import {
  AI_FILTER_EXTRACTOR,
  type ExtractionRequest,
  type ExtractionResult,
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
import {
  MAX_ATTEMPTS,
  MIN_ATTEMPT_MS,
  MODEL_BUDGET_MS,
  retryDelayMs,
  withTimeout,
} from './with-retry.js';

type Source = InterpretResponse['source'];
type FailureReason = FilterExtractorFailure | 'unexpected';

/** Ce que l'appel au modèle a donné, de quoi remplir la ligne `ai_requests` et le log. */
interface ModelCall {
  outcome: AiRequestOutcome;
  /** Filtres validés, seulement si `outcome` vaut `success`. */
  extraction: AiSearchExtraction | null;
  model: string | null;
  attempts: number;
  /** Durée des appels au modèle, attente entre eux comprise ; 0 sans appel. */
  latencyMs: number;
  usage: ExtractionUsage | null;
  reason?: FailureReason;
  status?: number;
  /** Sortie invalide : chemins des champs refusés par Zod (jamais leurs valeurs). */
  invalidFields?: string[];
}

const NO_CALL = { extraction: null, model: null, attempts: 0, latencyMs: 0, usage: null } as const;

const OUTCOME_BY_REASON: Record<FailureReason, AiRequestOutcome> = {
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
 * Échecs qui comptent pour le circuit breaker : le fournisseur est injoignable, saturé ou refuse
 * notre clé. Une clé refusée compte aussi : sans cela, chaque recherche referait l'appel et
 * produirait une erreur (Sentry) tant que la clé n'est pas changée.
 */
const UNAVAILABLE: ReadonlySet<FailureReason> = new Set([
  'timeout',
  'network',
  'rate_limited',
  'server_error',
  'unauthorized',
]);

/**
 * Échecs qui demandent une action (log `error`, donc Sentry) : une clé refusée, ou une requête que
 * le fournisseur refuse (400, paramètre ou modèle inconnu). Le repli par mots-clés les masquerait.
 */
const ACTION_REQUIRED: ReadonlySet<FailureReason> = new Set(['unauthorized', 'bad_request']);

/** Début du jour UTC de l'instant `ms` : le plafond journalier repart de zéro à minuit UTC. */
function startOfUtcDay(ms: number): Date {
  const date = new Date(ms);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Recherche en langage naturel : une phrase devient des filtres, jamais du SQL. Le modèle propose,
 * le schéma Zod valide, le géocodeur place le lieu ; si le modèle échoue, l'analyse par mots-clés
 * prend le relais. Aucune défaillance du modèle ne donne une erreur 5xx.
 *
 * Résilience, dans cet ordre : clé absente → circuit ouvert → plafond journalier atteint → appel,
 * coupé à `AI_TIMEOUT_MS`, repris une fois si l'échec est passager et si le budget de 5 s le permet.
 */
@Injectable()
export class AiSearchService implements OnModuleInit {
  private readonly logger = new Logger(AiSearchService.name);
  private readonly unpricedModelsLogged = new Set<string>();

  constructor(
    @Inject(AI_FILTER_EXTRACTOR) private readonly extractor: FilterExtractor,
    @Inject(GEOCODER) private readonly geocoder: Geocoder,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly breaker: CircuitBreaker,
    private readonly requests: AiRequestsRepository,
  ) {}

  onModuleInit(): void {
    // Sans clé, la recherche marche par mots-clés : en production, c'est sans doute un oubli.
    if (this.config.NODE_ENV === 'production' && !this.extractor.configured) {
      this.logger.warn({ event: 'ai.not_configured' });
    }
  }

  async interpret(query: string, requestId: string): Promise<InterpretResponse> {
    const startedAt = this.clock.now();
    const today = localDateOf(new Date(startedAt), SEARCH_TIMEZONE);

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
      call.outcome === 'success'
        ? 'log'
        : call.reason && ACTION_REQUIRED.has(call.reason)
          ? 'error'
          : 'warn';
    this.logger[level]({
      event: 'ai.request',
      outcome: call.outcome,
      source,
      model: call.model,
      attempts: call.attempts,
      latencyMs: call.latencyMs,
      durationMs: this.clock.now() - startedAt,
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

  /** Les contrôles avant l'appel, puis l'appel et la mise à jour du circuit. */
  private async callModel(request: ExtractionRequest): Promise<ModelCall> {
    if (!this.isConfigured()) return { outcome: 'not_configured', ...NO_CALL };
    if (!this.breaker.canAttempt()) return { outcome: 'circuit_open', ...NO_CALL };
    if (await this.dailyCapReached()) return { outcome: 'budget_exceeded', ...NO_CALL };
    // Pendant la lecture du plafond, une autre requête a pu prendre l'essai du circuit.
    if (!this.breaker.acquire()) return { outcome: 'circuit_open', ...NO_CALL };

    let call: ModelCall | undefined;
    try {
      call = await this.callWithRetry(request);
      return call;
    } finally {
      this.updateCircuit(call);
    }
  }

  /**
   * Plafond d'appels du jour (UTC), partagé par tous les réplicas via la base. Il est souple : deux
   * requêtes simultanées peuvent lire le même total et le dépasser d'une unité chacune. Base
   * illisible : on ne dépense pas sans pouvoir compter.
   */
  private async dailyCapReached(): Promise<boolean> {
    const cap = this.config.AI_DAILY_REQUEST_CAP;
    try {
      const attemptsToday = await this.requests.attemptsSince(startOfUtcDay(this.clock.now()));
      if (attemptsToday < cap) return false;
      this.logger.warn({ event: 'ai.budget_exceeded', attemptsToday, cap });
    } catch (error) {
      this.logger.error({ event: 'ai.budget_check_failed', err: describeError(error) });
    }
    return true;
  }

  /** Un appel coupé à `AI_TIMEOUT_MS`, et une reprise si l'échec est passager et le budget le permet. */
  private async callWithRetry(request: ExtractionRequest): Promise<ModelCall> {
    const startedAt = this.clock.now();
    const deadline = startedAt + MODEL_BUDGET_MS;
    const elapsed = () => this.clock.now() - startedAt;

    for (let attempt = 1; ; attempt++) {
      const timeoutMs = Math.min(this.config.AI_TIMEOUT_MS, deadline - this.clock.now());
      try {
        const result = await withTimeout(
          (signal) => this.extractor.extract(request, signal),
          timeoutMs,
        );
        return this.answered(result, attempt, elapsed());
      } catch (error) {
        if (error instanceof FilterExtractorError && error.reason === 'not_configured') {
          return { outcome: 'not_configured', ...NO_CALL };
        }
        const reason: FailureReason =
          error instanceof FilterExtractorError ? error.reason : 'unexpected';
        const details = error instanceof FilterExtractorError ? error.details : {};
        const delay =
          attempt < MAX_ATTEMPTS && reason !== 'unexpected'
            ? retryDelayMs(reason, details.retryAfterMs)
            : null;
        if (delay !== null && this.clock.now() + delay + MIN_ATTEMPT_MS <= deadline) {
          this.logger.warn({
            event: 'ai.retry',
            reason,
            attempt,
            delayMs: delay,
            ...(details.status === undefined ? {} : { status: details.status }),
          });
          await this.clock.sleep(delay);
          continue;
        }
        // Une erreur inattendue (bug de l'adapter ou du SDK) donne aussi un repli, jamais un 500.
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
          attempts: attempt,
          latencyMs: elapsed(),
          usage: details.usage ?? null,
          reason,
          ...(details.status === undefined ? {} : { status: details.status }),
        };
      }
    }
  }

  /** Le modèle a répondu : sa sortie est validée par le même schéma que celle des mots-clés. */
  private answered(result: ExtractionResult, attempts: number, latencyMs: number): ModelCall {
    const parsed = aiSearchExtractionSchema.safeParse(result.output);
    const common = { model: result.model, attempts, latencyMs, usage: result.usage };
    if (parsed.success) return { outcome: 'success', extraction: parsed.data, ...common };
    return {
      outcome: 'invalid_output',
      extraction: null,
      ...common,
      reason: 'invalid_output',
      invalidFields: parsed.error.issues.map((issue) => issue.path.join('.')),
    };
  }

  /**
   * Le modèle a répondu (même mal) : le circuit se referme. Il est injoignable ou refuse la clé :
   * l'échec compte. Ni l'un ni l'autre (requête refusée, erreur inattendue) : rien n'est tranché.
   */
  private updateCircuit(call: ModelCall | undefined): void {
    if (call?.outcome === 'success' || call?.outcome === 'invalid_output') {
      if (this.breaker.recordSuccess()) this.logger.log({ event: 'ai.circuit_closed' });
    } else if (call?.reason && UNAVAILABLE.has(call.reason)) {
      if (this.breaker.recordFailure()) {
        this.logger.warn({ event: 'ai.circuit_opened', reason: call.reason });
      }
    } else {
      this.breaker.recordNeutral();
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
   * qui contient le texte cherché. Géocodeur en panne, ou erreur imprévue : pas de lieu, la
   * recherche continue.
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
      if (error instanceof GeocoderError) {
        this.logger.warn({ event: 'ai.geocoding_failed', reason: error.reason });
      } else {
        // Un bug, pas une panne : `error`. Seulement le nom : le message peut contenir le lieu.
        this.logger.error({
          event: 'ai.geocoding_failed',
          err: { name: describeError(error).name },
        });
      }
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
