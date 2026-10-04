import {
  AI_IGNORED_TERM_MAX_LENGTH,
  AI_IGNORED_TERMS_MAX,
  PRICE_CENTS_MAX,
  SEARCH_RADIUS_OPTIONS_KM,
} from '@creno/shared';

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

/**
 * Tarif payant en dollars par million de tokens, soit des micro-dollars par token (relevé le
 * 2026-10-04 sur la documentation de Mistral). Enregistré même sur l'offre gratuite : c'est ce que
 * coûterait la production.
 */
const MODEL_PRICES: Readonly<Record<string, { input: number; output: number }>> = {
  'mistral-small-2603': { input: 0.15, output: 0.6 },
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
