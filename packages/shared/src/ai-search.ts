import { z } from 'zod';
import { localDateSchema } from './availability.js';
import { providerCategorySchema } from './providers.js';
import { PRICE_CENTS_MAX } from './resources.js';
import { SEARCH_RADIUS_KM_MAX, SEARCH_RADIUS_OPTIONS_KM } from './search.js';

/** Longueur de la phrase de recherche, espaces autour retirés. */
export const AI_QUERY_MIN = 3;
export const AI_QUERY_MAX = 200;
/** Lieu cité dans la phrase : au-delà, ce n'est plus un nom de lieu. */
export const AI_PLACE_MAX = 100;
export const AI_PRICE_MAX_EUROS = 10_000;
/**
 * Morceaux de phrase non pris en charge (heure, nombre de personnes…) : l'API les tronque à ces
 * limites au lieu de rejeter la sortie, pour qu'un détail ne fasse pas perdre toute l'interprétation.
 */
export const AI_IGNORED_TERMS_MAX = 5;
export const AI_IGNORED_TERM_MAX_LENGTH = 60;

/** Corps de `POST /search/interpret`, aussi validé par le formulaire de la barre de recherche. */
export const interpretRequestSchema = z.object({
  query: z
    .string()
    .trim()
    .min(AI_QUERY_MIN, { error: `${AI_QUERY_MIN} caractères minimum` })
    .max(AI_QUERY_MAX, { error: `${AI_QUERY_MAX} caractères maximum` }),
});
export type InterpretRequest = z.infer<typeof interpretRequestSchema>;

/** Catégories qu'une phrase peut désigner : « Autre » n'est jamais déduit d'une phrase. */
export const aiSearchCategorySchema = providerCategorySchema.exclude(['other']);

/**
 * Filtres extraits d'une phrase, par le modèle (sortie structurée, revalidée par ce schéma) ou par
 * l'analyse par mots-clés. Le lieu est un texte : c'est le géocodeur qui en fait une position, le
 * modèle ne produit jamais de coordonnées. Ce schéma est aussi converti en JSON Schema pour le modèle.
 */
export const aiSearchExtractionSchema = z.object({
  category: aiSearchCategorySchema.nullable(),
  /** Lieu tel qu'il est écrit dans la phrase (« Bordeaux », « 12 rue Oberkampf Paris »). */
  place: z.string().trim().min(1).max(AI_PLACE_MAX).nullable(),
  /** « Près de moi », « autour de moi » : la position du visiteur, que seul le navigateur connaît. */
  nearMe: z.boolean(),
  radiusKm: z.number().int().min(1).max(SEARCH_RADIUS_KM_MAX).nullable(),
  /** En euros, décimales acceptées (« 29,90 € ») : l'API arrondit en centimes. */
  priceMaxEuros: z.number().min(0).max(AI_PRICE_MAX_EUROS).nullable(),
  date: localDateSchema.nullable(),
  ignored: z.array(z.string()),
});
export type AiSearchExtraction = z.infer<typeof aiSearchExtractionSchema>;

/** Lieu interprété : libellé et position donnés par le géocodeur, position arrondie comme à l'étape 4. */
const interpretedPlaceSchema = z.object({
  label: z.string(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const interpretNoticeSchema = z.discriminatedUnion('type', [
  /** Lieu cité mais introuvable, ou géocodeur en panne : pas de filtre de lieu. */
  z.object({ type: z.literal('place_not_found'), place: z.string() }),
  /** Date passée ou au-delà de l'horizon de réservation : pas de filtre de date. */
  z.object({ type: z.literal('date_out_of_range'), date: localDateSchema }),
  /** Morceaux de phrase non pris en charge (« après 18 h »). */
  z.object({ type: z.literal('ignored_terms'), terms: z.array(z.string()).min(1) }),
]);
export type InterpretNotice = z.infer<typeof interpretNoticeSchema>;

export const interpretResponseSchema = z.object({
  /** `keywords` : le modèle n'a pas été appelé ou a échoué ; les filtres viennent des mots-clés. */
  source: z.enum(['ai', 'keywords']),
  /** Seulement les filtres cités : la page remet les autres à leur valeur par défaut. */
  filters: z.object({
    category: aiSearchCategorySchema.optional(),
    place: interpretedPlaceSchema.optional(),
    /** Seulement sans lieu cité : un lieu cité l'emporte sur « près de moi ». */
    nearMe: z.literal(true).optional(),
    /** Ramené à l'option la plus proche parmi celles de la recherche. */
    radiusKm: z.literal(SEARCH_RADIUS_OPTIONS_KM).optional(),
    /** Prix maximum en centimes. */
    priceMax: z.number().int().min(0).max(PRICE_CENTS_MAX).optional(),
    date: localDateSchema.optional(),
  }),
  notices: z.array(interpretNoticeSchema),
});
export type InterpretResponse = z.infer<typeof interpretResponseSchema>;
