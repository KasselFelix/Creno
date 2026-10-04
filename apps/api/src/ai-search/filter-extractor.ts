/** Jeton d'injection de l'extracteur : l'adapter Mistral est remplacé par un faux dans les tests. */
export const AI_FILTER_EXTRACTOR = Symbol('AI_FILTER_EXTRACTOR');

export interface ExtractionRequest {
  /** Phrase du visiteur, déjà validée (3 à 200 caractères). */
  query: string;
  /** Date du jour `YYYY-MM-DD` à l'heure de `SEARCH_TIMEZONE`, pour « demain », « samedi »… */
  today: string;
}

export interface ExtractionUsage {
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface ExtractionResult {
  /** Sortie du modèle, JSON déjà lu mais pas encore validé : c'est le service qui la valide. */
  output: unknown;
  /** Modèle qui a répondu (ex. `mistral-small-2603`). */
  model: string;
  usage: ExtractionUsage;
}

/** Service externe (LLM) qui transforme une phrase en filtres de recherche. */
export interface FilterExtractor {
  /** `false` : aucune clé, le service passe directement à l'analyse par mots-clés. */
  readonly configured: boolean;
  /** `signal` interrompt l'appel (timeout appliqué par le service). */
  extract(request: ExtractionRequest, signal: AbortSignal): Promise<ExtractionResult>;
}

export type FilterExtractorFailure =
  | 'not_configured'
  | 'timeout'
  | 'network'
  | 'rate_limited'
  /** 401 / 403 : clé refusée, action requise. */
  | 'unauthorized'
  /** Autre 4xx : requête refusée par le fournisseur. */
  | 'bad_request'
  | 'server_error'
  /** Réponse reçue mais inutilisable : coupée, vide ou JSON illisible. */
  | 'invalid_output';

/**
 * Échec de l'extracteur. Tout y est loggable : jamais la phrase, ni le message du fournisseur
 * (une erreur 422 peut recopier l'entrée). Une réponse inutilisable garde le modèle et les tokens,
 * qui sont facturés.
 */
export class FilterExtractorError extends Error {
  constructor(
    readonly reason: FilterExtractorFailure,
    readonly details: {
      status?: number;
      /** Délai demandé par le fournisseur avant de réessayer (en-tête `retry-after`). */
      retryAfterMs?: number;
      model?: string;
      usage?: ExtractionUsage;
    } = {},
  ) {
    super(`Extracteur de filtres indisponible (${reason})`);
    this.name = 'FilterExtractorError';
  }
}

/** Extracteur utilisé sans `MISTRAL_API_KEY` : l'API démarre, les phrases passent par les mots-clés. */
export class UnconfiguredFilterExtractor implements FilterExtractor {
  readonly configured = false;
  extract(): Promise<ExtractionResult> {
    return Promise.reject(new FilterExtractorError('not_configured'));
  }
}
