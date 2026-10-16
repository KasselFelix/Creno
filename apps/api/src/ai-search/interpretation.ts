import {
  AI_IGNORED_TERM_MAX_LENGTH,
  AI_IGNORED_TERMS_MAX,
  type AiSearchExtraction,
  normalizeTimeRange,
  PRICE_CENTS_MAX,
  SEARCH_RADIUS_OPTIONS_KM,
  TIME_OF_DAY_RANGES,
  type TimeRange,
} from '@creno/shared';
import { addLocalDays } from '../availability/slots.engine.js';

/**
 * Règles qui transforment une extraction (modèle ou mots-clés) en filtres de recherche. Fonctions
 * pures : testables sans base ni réseau.
 */

export type RadiusOptionKm = (typeof SEARCH_RADIUS_OPTIONS_KM)[number];

/** Option de rayon la plus proche (« 7 km » → 5) ; à égale distance, la plus petite. */
export function snapRadiusKm(km: number): RadiusOptionKm {
  return SEARCH_RADIUS_OPTIONS_KM.reduce((best, option) =>
    Math.abs(option - km) < Math.abs(best - km) ? option : best,
  );
}

/** Euros (décimales permises) → centimes, plafonnés comme le filtre de prix de la recherche. */
export function eurosToCents(euros: number): number {
  return Math.min(Math.round(euros * 100), PRICE_CENTS_MAX);
}

/** Morceaux non pris en charge : tronqués plutôt que rejetés, vides retirés. */
export function truncateIgnored(terms: string[]): string[] {
  return terms
    .map((term) => term.trim().slice(0, AI_IGNORED_TERM_MAX_LENGTH).trim())
    .filter((term) => term.length > 0)
    .slice(0, AI_IGNORED_TERMS_MAX);
}

// Heures `HH:mm` à largeur fixe : l'ordre des chaînes est l'ordre des heures.
const later = (a?: string, b?: string) => (a === undefined || (b !== undefined && b > a) ? b : a);
const earlier = (a?: string, b?: string) => (a === undefined || (b !== undefined && b < a) ? b : a);

/**
 * Plage horaire d'une extraction : bornes de la période (« l'après-midi »), resserrées par les
 * heures citées (« après 15 h »). Si les deux ne se recoupent pas (« le matin après 14 h »), les
 * heures citées l'emportent. Des heures inversées sont ignorées, sans faire perdre le reste de
 * l'interprétation. Bornes neutres retirées : `{}` veut dire toute la journée.
 */
export function resolveTimeRange({
  timeOfDay,
  startAfter,
  startBefore,
}: Pick<AiSearchExtraction, 'timeOfDay' | 'startAfter' | 'startBefore'>): TimeRange {
  const cited =
    normalizeTimeRange({ timeFrom: startAfter ?? undefined, timeTo: startBefore ?? undefined }) ??
    {};
  const period: TimeRange = timeOfDay === null ? {} : TIME_OF_DAY_RANGES[timeOfDay];
  const both = normalizeTimeRange({
    timeFrom: later(period.timeFrom, cited.timeFrom),
    timeTo: earlier(period.timeTo, cited.timeTo),
  });
  return both ?? cited;
}

/**
 * Jour d'une plage horaire quand la phrase n'en cite aucun (« coiffeur après 18 h ») : aujourd'hui
 * si la plage n'est pas encore finie à l'heure `nowTime` (`HH:mm`, heure de Paris), sinon demain
 * (« le matin », tapé à 15 h).
 */
export function dayForTimeRange(range: TimeRange, today: string, nowTime: string): string {
  return range.timeTo !== undefined && range.timeTo <= nowTime ? addLocalDays(today, 1) : today;
}

/**
 * Tarif payant en dollars par million de tokens, soit des micro-dollars par token (relevé le
 * 2026-10-04 sur la documentation de Mistral). Enregistré même sur l'offre gratuite : c'est ce que
 * coûterait la production.
 */
const MODEL_PRICES: Readonly<Record<string, { input: number; output: number }>> = {
  'mistral-small-2603': { input: 0.15, output: 0.6 },
  // Ministral 3 8B : plus petit, sortie moins chère ; repli quand Mistral Small n'a pas de quota.
  'ministral-8b-2512': { input: 0.15, output: 0.15 },
};

export function hasKnownPrice(model: string): boolean {
  return Object.hasOwn(MODEL_PRICES, model);
}

/** Coût d'un appel en micro-dollars entiers ; `null` si le modèle ou les tokens sont inconnus. */
export function costUsdMicros(
  model: string,
  usage: { inputTokens: number | null; outputTokens: number | null },
): number | null {
  const price = MODEL_PRICES[model];
  if (!price || usage.inputTokens === null || usage.outputTokens === null) return null;
  return Math.round(usage.inputTokens * price.input + usage.outputTokens * price.output);
}
