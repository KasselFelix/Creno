import { FilterExtractorError, type FilterExtractorFailure } from './filter-extractor.js';

/** Temps total accordé aux appels au modèle d'une interprétation, attente entre eux comprise. */
export const MODEL_BUDGET_MS = 5000;
/** Un appel, plus une seule reprise. */
export const MAX_ATTEMPTS = 2;
/** En dessous de ce temps restant, une reprise n'a aucune chance d'aboutir : on n'essaie pas. */
export const MIN_ATTEMPT_MS = 250;
/** L'offre gratuite de Mistral accepte environ une requête par seconde. */
const RATE_LIMIT_MIN_DELAY_MS = 1000;

/**
 * Attente avant une reprise, ou `null` si l'échec ne se reprend pas.
 * - Panne passagère (timeout, réseau, 5xx) : 250 à 500 ms, avec une part de hasard (jitter) pour que
 *   des requêtes tombées ensemble ne repartent pas ensemble.
 * - 429 : au moins une seconde, ou le délai demandé par le fournisseur s'il est plus long.
 * - Requête refusée (400, 401, 403) ou réponse inutilisable : reprendre ne changerait rien.
 */
export function retryDelayMs(
  reason: FilterExtractorFailure,
  retryAfterMs: number | undefined,
  random: () => number = Math.random,
): number | null {
  switch (reason) {
    case 'timeout':
    case 'network':
    case 'server_error':
      return Math.round(250 + random() * 250);
    case 'rate_limited':
      return Math.max(RATE_LIMIT_MIN_DELAY_MS, retryAfterMs ?? 0);
    default:
      return null;
  }
}

/**
 * Exécute `run` avec un signal qui s'interrompt au bout de `timeoutMs`, et n'attend pas plus
 * longtemps, même si `run` ignore le signal.
 */
export async function withTimeout<T>(
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
